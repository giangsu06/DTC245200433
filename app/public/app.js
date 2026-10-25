const grid = document.querySelector("#movie-grid");
const dialog = document.querySelector("#booking-dialog");
const bookingContent = document.querySelector("#booking-content");
const toast = document.querySelector("#toast");

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
        <div class="card-bottom"><span class="availability">${item.seats_available} ghế trống</span><button class="button button-dark" data-screening="${item.screening_id}" data-title="${escapeHtml(item.title)}" data-price="${item.ticket_price}">Chọn ghế <span>→</span></button></div>
      </div>
    </article>`).join("");
  grid.querySelectorAll("[data-screening]").forEach((button) => button.addEventListener("click", () => {
    openBooking(Number(button.dataset.screening), button.dataset.title, Number(button.dataset.price));
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function openBooking(screeningId, title, price) {
  bookingContent.innerHTML = '<p class="booking-loading" role="status" aria-live="polite">Đang tải sơ đồ ghế...</p>';
  if (!dialog.open) dialog.showModal();

  try {
    const seatMap = await request(`/api/screenings/${screeningId}/seats`);
    bookingContent.innerHTML = `
      <p class="eyebrow">CHỌN CHỖ NGỒI</p><h2>${escapeHtml(title)}</h2>
      <p class="dialog-subtitle">Chọn tối đa 8 ghế. ${money.format(price)} / ghế.</p>
      <div class="screen-label">MÀN HÌNH</div>
      <div class="seat-map">${seatMap.seats.map((seat) => `<button type="button" class="seat ${seat.booked ? "booked" : ""}" data-seat="${seat.number}" ${seat.booked ? "disabled" : ""} aria-label="Ghế ${seat.number}${seat.booked ? ", đã đặt" : ""}">${seat.number}</button>`).join("")}</div>
      <div class="seat-legend"><span><i></i> Còn trống</span><span><i class="selected"></i> Đang chọn</span><span><i class="taken"></i> Đã đặt</span></div>
      <form id="booking-form" class="booking-form">
        <label>Họ tên<input name="customerName" required minlength="2" maxlength="120" autocomplete="name" placeholder="Nguyễn Văn A"></label>
        <label>Email<input name="customerEmail" required type="email" maxlength="190" autocomplete="email" placeholder="ban@example.com"></label>
        <div class="total-row"><span>Tổng tiền (mô phỏng, không thu tiền thật)</span><strong id="booking-total">${money.format(0)}</strong></div>
        <button class="button button-dark submit-booking" type="submit">Xác nhận đặt vé <span>→</span></button>
      </form>`;

    const selected = new Set();
    const total = bookingContent.querySelector("#booking-total");
    bookingContent.querySelectorAll(".seat:not(.booked)").forEach((seat) => seat.addEventListener("click", () => {
      if (!selected.has(Number(seat.dataset.seat)) && selected.size >= 8) {
        showToast("Mỗi lần đặt tối đa 8 ghế.");
        return;
      }
      const number = Number(seat.dataset.seat);
      if (selected.has(number)) selected.delete(number);
      else selected.add(number);
      seat.classList.toggle("selected", selected.has(number));
      total.textContent = money.format(selected.size * price);
    }));

    bookingContent.querySelector("#booking-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selected.size) return showToast("Vui lòng chọn ít nhất một ghế.");
      const form = new FormData(event.currentTarget);
      const submit = event.currentTarget.querySelector("button[type=submit]");
      submit.disabled = true;
      try {
        const result = await request("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screeningId,
            seats: Array.from(selected),
            customerName: form.get("customerName"),
            customerEmail: form.get("customerEmail")
          })
        });
        bookingContent.innerHTML = `
          <section class="booking-success" role="status" aria-live="polite">
            <p class="eyebrow">ĐẶT VÉ THÀNH CÔNG</p>
            <h2>Vé của bạn đã được ghi nhận</h2>
            <p>Mã đặt vé</p>
            <strong class="booking-code">${escapeHtml(result.bookingCode)}</strong>
            <p>Ghế: ${result.seats.join(", ")}</p>
            <p class="payment-notice">Trạng thái: đã tạo vé · Thanh toán mô phỏng, không phát sinh giao dịch tiền thật.</p>
            <button class="button button-dark" id="close-confirmation" type="button">Đóng</button>
          </section>`;
        bookingContent.querySelector("#close-confirmation").addEventListener("click", () => dialog.close());
        loadMovies();
      } catch (error) {
        if (error.status === 409) {
          showToast(error.message);
          openBooking(screeningId, title, price);
          return;
        }
        showToast(error.message);
        submit.disabled = false;
        submit.textContent = "Thử đặt vé lại";
      }
    });
  } catch (error) {
    showToast(error.message);
    bookingContent.innerHTML = `
      <section class="booking-error" role="alert">
        <p>Không thể tải sơ đồ ghế: ${escapeHtml(error.message)}</p>
        <button class="button button-dark" id="retry-seats" type="button">Thử lại</button>
      </section>`;
    bookingContent.querySelector("#retry-seats").addEventListener("click", () => openBooking(screeningId, title, price));
  }
}

async function loadMovies() {
  try {
    renderMovies(await request("/api/movies"));
  } catch (error) {
    grid.innerHTML = `
      <div class="empty" role="alert">
        <p>Không tải được lịch chiếu. ${escapeHtml(error.message)}</p>
        <button class="button button-dark" id="retry-movies" type="button">Tải lại</button>
      </div>`;
    grid.querySelector("#retry-movies").addEventListener("click", loadMovies);
  }
}

loadMovies();
