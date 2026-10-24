const express = require("express");
const helmet = require("helmet");
const mysql = require("mysql2/promise");
const client = require("prom-client");
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
const httpRequests = new client.Counter({
  name: "cinema_http_requests_total",
  help: "Total HTTP requests handled by the application",
  labelNames: ["method", "route", "status"]
});
const bookingsCreated = new client.Counter({
  name: "cinema_bookings_created_total",
  help: "Total tickets booked using the simulated payment flow"
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  xContentTypeOptions: false,
  referrerPolicy: false,
  hsts: false
}));
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.on("finish", () => {
    httpRequests.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status: String(res.statusCode)
    });
  });
  next();
});

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check failed:", error.message);
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
  const screeningId = Number(req.body.screeningId);
  const seats = req.body.seats;
  const customerName = typeof req.body.customerName === "string" ? req.body.customerName.trim() : "";
  const customerEmail = typeof req.body.customerEmail === "string" ? req.body.customerEmail.trim() : "";

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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [screenings] = await connection.query(
      "SELECT id, seat_capacity, starts_at FROM screenings WHERE id = ? FOR UPDATE",
      [screeningId]
    );
    if (!screenings.length || new Date(screenings[0].starts_at) <= new Date()) {
      await connection.rollback();
      return res.status(404).json({ error: "Lịch chiếu không tồn tại hoặc đã bắt đầu." });
    }
    if (seats.some((seat) => seat > screenings[0].seat_capacity)) {
      await connection.rollback();
      return res.status(400).json({ error: "Số ghế vượt quá sức chứa phòng chiếu." });
    }
    const [existing] = await connection.query(
      "SELECT seat_number FROM bookings WHERE screening_id = ? AND seat_number IN (?)",
      [screeningId, seats]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ error: "Một hoặc nhiều ghế vừa được người khác đặt." });
    }

    await connection.query(
      `INSERT INTO bookings
        (screening_id, seat_number, customer_name, customer_email, payment_status)
       VALUES ?`,
      [seats.map((seat) => [screeningId, seat, customerName, customerEmail, "simulated_paid"])]
    );
    await connection.commit();
    bookingsCreated.inc(seats.length);
    res.status(201).json({
      message: "Đặt vé thành công. Đây là thanh toán mô phỏng, không phát sinh giao dịch thật.",
      screeningId,
      seats,
      paymentStatus: "simulated_paid"
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ghế đã được đặt, vui lòng chọn ghế khác." });
    }
    next(error);
  } finally {
    connection.release();
  }
});

app.use(express.static(path.join(__dirname, "../public"), { maxAge: "1h" }));

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  res.status(500).json({ error: "Có lỗi hệ thống. Vui lòng thử lại sau." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Cinema app listening on ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
