const express = require("express");
const helmet = require("helmet");
const mysql = require("mysql2/promise");
const client = require("prom-client");
const crypto = require("crypto");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "cinema",
  user: process.env.DB_USER || "cinema_app",
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

client.collectDefaultMetrics({ prefix: "cinema_" });
function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNHANDLED";
}

function writeLog(level, event, fields = {}) {
  const output = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  output(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "cinema-app",
    event,
    ...fields
  }));
}

const httpRequests = new client.Counter({
  name: "cinema_http_requests_total",
  help: "Total HTTP requests handled by the application",
  labelNames: ["method", "route", "status"]
});
const httpRequestDuration = new client.Histogram({
  name: "cinema_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});
const bookingsCreated = new client.Counter({
  name: "cinema_bookings_created_total",
  help: "Total successful booking requests using the simulated payment flow"
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  xContentTypeOptions: false,
  referrerPolicy: false,
  hsts: false
}));
app.use((req, res, next) => {
  const suppliedRequestId = req.get("x-request-id");
  const requestId = suppliedRequestId && /^[a-f0-9]{32}$/i.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID().replace(/-/g, "");
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const labels = {
      method: req.method,
      route: req.route ? req.route.path : "unmatched",
      status: String(res.statusCode)
    };
    httpRequests.inc(labels);
    httpRequestDuration.observe(labels, durationMs / 1000);
    writeLog(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "http_request", {
      request_id: requestId,
      method: req.method,
      route: labels.route,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100
    });
  });
  next();
});
app.use(express.json({ limit: "20kb" }));

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "connected" });
  } catch (error) {
    writeLog("error", "health_check_failed", { error_code: safeErrorCode(error) });
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.get("/admin", (_req, res) => {
  res.redirect(process.env.PMA_PUBLIC_URL || "http://localhost:8081");
});

app.get("/api/movies", async (_req, res, next) => {
  try {
    const [movies] = await pool.query(
      `SELECT m.id, m.title, m.description, m.genre, m.duration_minutes,
              m.poster_emoji, s.id AS screening_id, s.starts_at, s.room_name,
              s.seat_capacity, s.ticket_price,
              s.seat_capacity - COUNT(b.id) AS seats_available
         FROM movies m
         JOIN screenings s ON s.movie_id = m.id AND s.starts_at > NOW()
         LEFT JOIN bookings b ON b.screening_id = s.id
        GROUP BY m.id, s.id
        ORDER BY s.starts_at`
    );
    res.json(movies);
  } catch (error) {
    next(error);
  }
});

app.get("/api/screenings/:id/seats", async (req, res, next) => {
  const screeningId = Number(req.params.id);
  if (!Number.isSafeInteger(screeningId) || screeningId < 1) {
    return res.status(400).json({ error: "Lịch chiếu không hợp lệ." });
  }
  try {
    const [screenings] = await pool.query(
      "SELECT id, seat_capacity FROM screenings WHERE id = ? AND starts_at > NOW()",
      [screeningId]
    );
    if (!screenings.length) return res.status(404).json({ error: "Không tìm thấy lịch chiếu." });
    const [booked] = await pool.query(
      "SELECT seat_number FROM bookings WHERE screening_id = ?",
      [screeningId]
    );
    const bookedSeats = new Set(booked.map((row) => row.seat_number));
    res.json({
      screeningId,
      seats: Array.from({ length: screenings[0].seat_capacity }, (_, index) => ({
        number: index + 1,
        booked: bookedSeats.has(index + 1)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings", async (req, res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const screeningId = Number(body.screeningId);
  const seats = body.seats;
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim() : "";

  if (
    !Number.isSafeInteger(screeningId) ||
    screeningId < 1 ||
    !Array.isArray(seats) ||
    seats.length < 1 ||
    seats.length > 8 ||
    seats.some((seat) => !Number.isSafeInteger(seat) || seat < 1) ||
    new Set(seats).size !== seats.length ||
    customerName.length < 2 ||
    customerName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
    customerEmail.length > 190
  ) {
    return res.status(400).json({ error: "Thông tin đặt vé chưa hợp lệ (tối đa 8 ghế/lần)." });
  }

  let connection;
  let transactionStarted = false;
  let discardConnection = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [screenings] = await connection.query(
      "SELECT id, seat_capacity, starts_at FROM screenings WHERE id = ? FOR UPDATE",
      [screeningId]
    );
    if (!screenings.length || new Date(screenings[0].starts_at) <= new Date()) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: "Lịch chiếu không tồn tại hoặc đã bắt đầu." });
    }
    if (seats.some((seat) => seat > screenings[0].seat_capacity)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: "Số ghế vượt quá sức chứa phòng chiếu." });
    }
    const [existing] = await connection.query(
      "SELECT seat_number FROM bookings WHERE screening_id = ? AND seat_number IN (?)",
      [screeningId, seats]
    );
    if (existing.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: "Một hoặc nhiều ghế vừa được người khác đặt." });
    }

    const [insertResult] = await connection.query(
      `INSERT INTO bookings
        (screening_id, seat_number, customer_name, customer_email, payment_status)
       VALUES ?`,
      [seats.map((seat) => [screeningId, seat, customerName, customerEmail, "simulated_paid"])]
    );
    await connection.commit();
    transactionStarted = false;
    bookingsCreated.inc();
    res.status(201).json({
      message: "Đặt vé thành công. Đây là thanh toán mô phỏng, không phát sinh giao dịch thật.",
      bookingCode: `RM-${String(insertResult.insertId).padStart(8, "0")}`,
      screeningId,
      seats,
      paymentStatus: "simulated_paid"
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
        transactionStarted = false;
      } catch (rollbackError) {
        writeLog("error", "booking_rollback_failed", { error_code: safeErrorCode(rollbackError) });
        discardConnection = true;
      }
    }
    if (error.code === "ER_DUP_ENTRY" && !discardConnection) {
      return res.status(409).json({ error: "Ghế đã được đặt, vui lòng chọn ghế khác." });
    }
    next(error);
  } finally {
    if (connection) {
      if (discardConnection) connection.destroy();
      else connection.release();
    }
  }
});

app.use(express.static(path.join(__dirname, "../public"), { maxAge: "1h" }));

app.use((error, req, res, _next) => {
  writeLog("error", "request_failed", {
    request_id: req.requestId,
    error_code: safeErrorCode(error)
  });
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const message = status === 400
    ? "Yêu cầu không hợp lệ. Vui lòng kiểm tra dữ liệu gửi lên."
    : status === 413
      ? "Dữ liệu gửi lên vượt quá giới hạn cho phép."
      : "Có lỗi hệ thống. Vui lòng thử lại sau.";
  res.status(status).json({ error: message });
});

const server = app.listen(port, "0.0.0.0", () => {
  writeLog("info", "server_started", { port });
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
