const grid = document.querySelector("#movie-grid");
const dialog = document.querySelector("#booking-dialog");
const bookingContent = document.querySelector("#booking-content");
const toast = document.querySelector("#toast");

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const seatsPerRow = 8;

async function request(url, options) {
  const response = await fetch(url, options);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.");
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Không thể hoàn tất yêu cầu.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function seatLabel(number) {
  const row = String.fromCharCode(65 + Math.floor((number - 1) / seatsPerRow));
  return `${row}${((number - 1) % seatsPerRow) + 1}`;
}

function renderMovies(screenings) {
  if (!screenings.length) {
    grid.innerHTML = '<p class="empty">Hiện chưa có lịch chiếu sắp tới.</p>';
    return;
  }
  grid.innerHTML = screenings.map((item) => `
    <article class="movie-card">
      <div class="poster"><span>${escapeHtml(item.poster_emoji)}</span><small>${escapeHtml(item.genre)}</small></div>
      <div class="movie-info">
        <div class="movie-title"><div><h3>${escapeHtml(item.title)}</h3><p>${item.duration_minutes} phút · ${escapeHtml(item.room_name)}</p></div><span class="rating">★ 9.2</span></div>
        <p class="description">${escapeHtml(item.description)}</p>
        <div class="screening"><span>${dateTime.format(new Date(item.starts_at))}</span><strong>${money.format(Number(item.ticket_price))}</strong></div>
        <div class="card-bottom"><span class="availability">${item.seats_available} ghế trống</span><button class="button button-dark" type="button" data-screening="${item.screening_id}">Chọn ghế <span>→</span></button></div>
      </div>
    </article>`).join("");
  grid.querySelectorAll("[data-screening]").forEach((button, index) => {
    button.addEventListener("click", () => openBooking(screenings[index]));
  });
}

function renderProgress(activeStep) {
  return `<ol class="booking-steps" aria-label="Tiến trình đặt vé">
    <li class="${activeStep === 1 ? "active" : "complete"}"><span>01</span> Chọn ghế</li>
    <li class="${activeStep === 2 ? "active" : activeStep > 2 ? "complete" : ""}"><span>02</span> Thanh toán demo</li>
    <li class="${activeStep === 3 ? "active" : ""}"><span>03</span> Hoàn tất</li>
  </ol>`;
}

function renderSeatRows(seats, selected) {
  const rows = [];
  for (let index = 0; index < seats.length; index += seatsPerRow) {
    const rowSeats = seats.slice(index, index + seatsPerRow);
    const rowLabel = String.fromCharCode(65 + Math.floor(index / seatsPerRow));
    rows.push(`<div class="seat-row" role="group" aria-label="Hàng ghế ${rowLabel}">
      <span class="seat-row-label" aria-hidden="true">${rowLabel}</span>
      ${rowSeats.slice(0, 3).map((seat) => renderSeat(seat, selected)).join("")}
      <span class="seat-aisle" aria-hidden="true"></span>
      ${rowSeats.slice(3).map((seat) => renderSeat(seat, selected)).join("")}
    </div>`);
  }
  return rows.join("");
}

function renderSeat(seat, selected) {
  const label = seatLabel(seat.number);
  const state = seat.booked ? "đã đặt" : selected.has(seat.number) ? "đang chọn" : "còn trống";
  return `<button type="button" class="seat${seat.booked ? " booked" : ""}${selected.has(seat.number) ? " selected" : ""}"
      data-seat="${seat.number}" ${seat.booked ? "disabled" : ""}
      aria-label="Ghế ${label}, ${state}" aria-pressed="${selected.has(seat.number)}">${label}</button>`;
}

function openBooking(screening) {
  const booking = {
    screeningId: Number(screening.screening_id),
    title: screening.title,
    price: Number(screening.ticket_price),
    startsAt: screening.starts_at,
    roomName: screening.room_name,
    selected: new Set(),
    customerName: "",
    customerEmail: "",
    seats: []
  };

  bookingContent.innerHTML = '<p class="booking-loading" role="status" aria-live="polite">Đang tải sơ đồ ghế...</p>';
  if (!dialog.open) dialog.showModal();
  loadSeatSelection(booking);
}

async function loadSeatSelection(booking) {
  try {
    const seatMap = await request(`/api/screenings/${booking.screeningId}/seats`);
    booking.seats = seatMap.seats;
    for (const number of booking.selected) {
      if (booking.seats.find((seat) => seat.number === number)?.booked) booking.selected.delete(number);
    }
    renderSeatSelection(booking);
  } catch (error) {
    showToast(error.message);
    bookingContent.innerHTML = `
      <section class="booking-error" role="alert">
        <p>Không thể tải sơ đồ ghế: ${escapeHtml(error.message)}</p>
        <button class="button button-dark" id="retry-seats" type="button">Thử lại</button>
      </section>`;
    bookingContent.querySelector("#retry-seats").addEventListener("click", () => loadSeatSelection(booking));
  }
}

function renderSeatSelection(booking) {
  bookingContent.innerHTML = `
    ${renderProgress(1)}
    <p class="eyebrow">CHỌN CHỖ NGỒI</p>
    <h2>${escapeHtml(booking.title)}</h2>
    <p class="dialog-subtitle">${dateTime.format(new Date(booking.startsAt))} · ${escapeHtml(booking.roomName)} · ${money.format(booking.price)} / ghế</p>
    <div class="booking-layout">
      <section class="seat-selection-panel" aria-label="Sơ đồ ghế">
        <div class="screen-label">MÀN HÌNH</div>
        <div class="seat-map seat-map--rows">${renderSeatRows(booking.seats, booking.selected)}</div>
        <div class="seat-legend"><span><i></i> Còn trống</span><span><i class="selected"></i> Đang chọn</span><span><i class="taken"></i> Đã đặt</span></div>
      </section>
      <section class="booking-details-panel" aria-label="Thông tin đặt vé">
        <div class="seat-selection-summary">
          <span>Ghế đã chọn <strong id="selected-seat-labels">Chưa chọn ghế</strong></span>
          <span>Tạm tính <strong id="booking-total">${money.format(booking.selected.size * booking.price)}</strong></span>
        </div>
        <form id="booking-form" class="booking-form">
          <label>Họ tên<input name="customerName" required minlength="2" maxlength="120" autocomplete="name" placeholder="Nguyễn Văn A" value="${escapeHtml(booking.customerName)}"></label>
          <label>Email nhận vé<input name="customerEmail" required type="email" maxlength="190" autocomplete="email" placeholder="ban@example.com" value="${escapeHtml(booking.customerEmail)}"></label>
          <p class="form-hint">Thông tin chỉ dùng cho vé demo; không nhập dữ liệu thanh toán thật.</p>
          <button class="button button-dark submit-booking" type="submit">Tiếp tục đến thanh toán <span>→</span></button>
        </form>
      </section>
    </div>`;

  const updateSummary = () => {
    const labels = Array.from(booking.selected).sort((a, b) => a - b).map(seatLabel);
    bookingContent.querySelector("#selected-seat-labels").textContent = labels.length ? labels.join(", ") : "Chưa chọn ghế";
    bookingContent.querySelector("#booking-total").textContent = money.format(labels.length * booking.price);
    bookingContent.querySelectorAll(".seat:not(.booked)").forEach((element) => {
      const number = Number(element.dataset.seat);
      const isSelected = booking.selected.has(number);
      element.classList.toggle("selected", isSelected);
      element.setAttribute("aria-pressed", String(isSelected));
      element.setAttribute("aria-label", `Ghế ${seatLabel(number)}, ${isSelected ? "đang chọn" : "còn trống"}`);
    });
  };

  bookingContent.querySelectorAll(".seat:not(.booked)").forEach((seat) => seat.addEventListener("click", () => {
    const number = Number(seat.dataset.seat);
    if (!booking.selected.has(number) && booking.selected.size >= 8) {
      showToast("Mỗi lần đặt tối đa 8 ghế.");
      return;
    }
    if (booking.selected.has(number)) booking.selected.delete(number);
    else booking.selected.add(number);
    updateSummary();
  }));

  bookingContent.querySelector("#booking-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!booking.selected.size) {
      showToast("Vui lòng chọn ít nhất một ghế.");
      return;
    }
    const form = new FormData(event.currentTarget);
    booking.customerName = String(form.get("customerName")).trim();
    booking.customerEmail = String(form.get("customerEmail")).trim();
    renderPaymentReview(booking);
  });

  updateSummary();
}

function renderPaymentReview(booking) {
  const seats = Array.from(booking.selected).sort((a, b) => a - b);
  bookingContent.innerHTML = `
    ${renderProgress(2)}
    <p class="eyebrow">KIỂM TRA ĐƠN VÉ</p>
    <h2>Xác nhận thông tin</h2>
    <p class="dialog-subtitle">Kiểm tra lại lựa chọn trước khi xác nhận thanh toán mô phỏng.</p>
    <section class="checkout-card" aria-label="Thông tin đơn đặt vé">
      <div class="checkout-movie"><span class="checkout-icon" aria-hidden="true">🎬</span><div><strong>${escapeHtml(booking.title)}</strong><span>${dateTime.format(new Date(booking.startsAt))} · ${escapeHtml(booking.roomName)}</span></div></div>
      <div class="checkout-line"><span>Ghế (${seats.length})</span><strong>${seats.map(seatLabel).join(", ")}</strong></div>
      <div class="checkout-line"><span>Khách hàng</span><strong>${escapeHtml(booking.customerName)}</strong></div>
      <div class="checkout-line"><span>Email nhận vé</span><strong class="checkout-email">${escapeHtml(booking.customerEmail)}</strong></div>
      <div class="checkout-total"><span>Tổng thanh toán</span><strong>${money.format(seats.length * booking.price)}</strong></div>
    </section>
    <aside class="mock-payment-note">
      <span aria-hidden="true">✓</span>
      <div><strong>Thanh toán giả lập</strong><p>Không kết nối ngân hàng, không thu tiền và không yêu cầu thông tin thẻ.</p></div>
    </aside>
    <div class="checkout-actions">
      <button class="button button-back" id="back-to-seats" type="button">← Quay lại</button>
      <button class="button button-dark submit-booking" id="confirm-payment" type="button">Xác nhận thanh toán demo <span>→</span></button>
    </div>`;
  bookingContent.querySelector("#back-to-seats").addEventListener("click", () => renderSeatSelection(booking));
  bookingContent.querySelector("#confirm-payment").addEventListener("click", () => submitBooking(booking, seats));
}

async function submitBooking(booking, seats) {
  const submit = bookingContent.querySelector("#confirm-payment");
  submit.disabled = true;
  submit.textContent = "Đang xác nhận...";
  try {
    const result = await request("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screeningId: booking.screeningId,
        seats,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail
      })
    });
    if (result.paymentStatus !== "simulated_paid") {
      throw new Error("Không xác nhận được trạng thái thanh toán demo.");
    }
    renderBookingSuccess(booking, result, seats);
    loadMovies();
  } catch (error) {
    if (error.status === 409) {
      showToast(error.message);
      await loadSeatSelection(booking);
      return;
    }
    showToast(error.message);
    submit.disabled = false;
    submit.innerHTML = 'Thử xác nhận lại <span>→</span>';
  }
}

function renderBookingSuccess(booking, result, seats) {
  bookingContent.innerHTML = `
    ${renderProgress(3)}
    <section class="booking-success" role="status" aria-live="polite">
      <div class="success-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">ĐẶT VÉ THÀNH CÔNG</p>
      <h2>Hẹn gặp bạn tại rạp!</h2>
      <p class="success-intro">${escapeHtml(booking.title)} · ${dateTime.format(new Date(booking.startsAt))}</p>
      <div class="ticket-summary">
        <span>Mã đặt vé</span>
        <strong class="booking-code">${escapeHtml(result.bookingCode)}</strong>
        <span>Phòng ${escapeHtml(booking.roomName)} · Ghế ${seats.map(seatLabel).join(", ")}</span>
        <strong class="ticket-total">${money.format(seats.length * booking.price)}</strong>
      </div>
      <p class="payment-notice">Thanh toán đã được xác nhận ở chế độ mô phỏng. Không có giao dịch tiền thật.</p>
      <button class="button button-dark" id="close-confirmation" type="button">Hoàn tất</button>
    </section>`;
  bookingContent.querySelector("#close-confirmation").addEventListener("click", () => dialog.close());
}

async function loadMovies() {
  try {
    renderMovies(await request("/api/movies"));
  } catch (error) {
    grid.innerHTML = `
      <div class="empty" role="alert">
        <p>Không tải được lịch chiếu. ${escapeHtml(error.message)}</p>
        <button class="button button-dark" id="retry-movies">Tải lại</button>
      </div>`;
    grid.querySelector("#retry-movies").addEventListener("click", loadMovies);
  }
}

loadMovies();
