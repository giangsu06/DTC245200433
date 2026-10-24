# Rạp Mây — nền tảng đặt vé xem phim

Đồ án triển khai website đặt vé xem phim/sự kiện bằng Docker Compose: Express + MySQL + phpMyAdmin, Nginx reverse proxy, Prometheus + Grafana, Loki + Promtail và các cấu hình hardening cơ bản.

> Thanh toán chỉ là **mô phỏng** để phục vụ demo. Không nhập dữ liệu thẻ hoặc thông tin thanh toán thật.

## 1. Kiến trúc

```text
Trình duyệt
   ├── http://localhost:8080 ── Nginx (reverse proxy, security headers) ── Express
   │                                                                       └── MySQL
   ├── http://localhost:8081 ── phpMyAdmin ──────────────────────────────────┘
   └── http://localhost:3000 ── Grafana ── Prometheus / Loki
                                           ├── cAdvisor (metrics container)
                                           ├── MySQL exporter
                                           ├── Nginx exporter
                                           └── Promtail (Docker logs) ── Loki
```

Các cổng giao diện quản trị được bind vào `127.0.0.1`; MySQL và Loki không publish cổng ra host. Mạng `data` và `observability` là mạng nội bộ; `management` chỉ nối phpMyAdmin/Grafana tới các cổng host cục bộ. Promtail chỉ đọc metadata/log qua Docker socket proxy với API chỉ bật các quyền cần cho discovery và events.

## 2. Yêu cầu

- Docker Desktop với Linux containers và Docker Compose v2.
- Windows 10/11, macOS hoặc Linux.
- RAM khuyến nghị tối thiểu 6 GB cho toàn bộ stack.

> cAdvisor cần Docker Engine có hỗ trợ mount `/sys`, `/var/lib/docker` và `/var/run`. Trên Docker Desktop, một số chỉ số host/container có thể khác hoặc không khả dụng như trên Linux.

## 3. Khởi chạy trên Windows PowerShell

Mở PowerShell tại thư mục project:

```powershell
Copy-Item .env.example .env
notepad .env
```

Thay **tất cả** giá trị `ReplaceWithLongRandom...` bằng mật khẩu ngẫu nhiên riêng, dài ít nhất 32 ký tự; chỉ dùng chữ và số cho MySQL/Grafana, và chữ, số, dấu gạch dưới hoặc gạch ngang cho `MYSQL_EXPORTER_PASSWORD`. Không đưa `.env` lên GitHub.

```powershell
docker compose config
docker compose up -d --build
docker compose ps
```

Đợi các service `healthy`/`running`, sau đó truy cập:

| Thành phần | Địa chỉ |
|---|---|
| Website qua Nginx | <http://localhost:8080> |
| phpMyAdmin | <http://localhost:8081> |
| Grafana | <http://localhost:3000> |
| Prometheus | <http://localhost:9090> |
| Health check ứng dụng | <http://localhost:8080/healthz> |

Các cổng host có thể đổi bằng `CINEMA_WEB_PORT`, `CINEMA_PMA_PORT`, `CINEMA_GRAFANA_PORT` và `CINEMA_PROMETHEUS_PORT` trong `.env` nếu bị dịch vụ khác sử dụng.
Đăng nhập phpMyAdmin bằng `MYSQL_USER` / `MYSQL_PASSWORD` trong `.env`. Đăng nhập Grafana bằng `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`. Dashboard **Cinema platform overview** và hai data source Prometheus/Loki được provision tự động.

Theo dõi trạng thái/log:

```powershell
docker compose ps
docker compose logs -f app nginx db prometheus grafana loki promtail
```

## 4. Demo chức năng đặt vé

1. Mở website, chọn phim/lịch chiếu, chọn một hoặc nhiều ghế.
2. Nhập tên và email demo rồi bấm xác nhận. Mỗi lần đặt tối đa 8 ghế.
3. Chọn lại lịch chiếu: ghế vừa đặt hiển thị đã có người chọn.
4. Kiểm tra bảng `movies`, `screenings`, `bookings` trong phpMyAdmin.
5. Tranh chấp đặt cùng một ghế được bảo vệ bằng transaction khóa lịch chiếu và unique key `(screening_id, seat_number)`.

## 5. Giám sát Prometheus/Grafana

Prometheus scrape các target `cinema-app`, `mysql`, `nginx`, `containers` mỗi 15 giây. Trong Prometheus, mở **Status → Targets** và xác nhận target `UP`. Dashboard provision sẵn hiển thị request/booking, CPU/RAM container, kết nối Nginx/MySQL và truy vấn DB.

Một số biểu thức PromQL có thể dùng ở Grafana Explore:

```promql
sum by (status) (rate(cinema_http_requests_total[5m]))
sum(cinema_bookings_created_total)
container_memory_working_set_bytes{name!=""}
mysql_global_status_threads_connected
nginx_connections_active
```

Tạo lưu lượng bằng cách tải trang và đặt thử một vé để các biểu đồ bắt đầu có dữ liệu. Một số chỉ số cAdvisor/MySQL exporter phụ thuộc runtime và phiên bản Docker/MySQL.

## 6. Loki và LogQL

Trong Grafana chọn **Explore → Loki**. Các truy vấn mẫu:

```logql
{project="cinema-platform"}
{project="cinema-platform", service="nginx"} |= "POST /api/bookings"
{project="cinema-platform", service="nginx"} |~ " 4[0-9][0-9] "
```

Các truy vấn lần lượt xem toàn bộ log của project, tìm request đặt vé và lọc phản hồi HTTP 4xx. Nếu nhãn Compose project trên máy khác không phải `cinema-platform`, bỏ matcher `project` hoặc dùng `{service="nginx"}`. Đặt truy vấn khoảng thời gian **Last 15 minutes**, sau đó mở website/tạo request để có log mới. Log được giữ tối đa 7 ngày trong volume Loki.

## 7. Cấu hình bảo mật

- Ứng dụng chạy bằng user `node`, filesystem chỉ đọc, bỏ Linux capabilities và bật `no-new-privileges`.
- Nginx chạy non-root trên cổng 8080, filesystem chỉ đọc, chỉ có tmpfs cần thiết.
- Mạng `data` cô lập khỏi mạng ngoài; MySQL không publish port. Ứng dụng dùng tài khoản DB riêng do Compose tạo, không dùng root.
- MySQL exporter dùng tài khoản chỉ có quyền metrics (`PROCESS`, `REPLICATION CLIENT`, `SELECT`); mật khẩu lấy từ `.env` và nội suy trong tệp cấu hình exporter.
- Grafana tắt đăng ký và anonymous access; cổng quản trị chỉ bind `127.0.0.1`.
- Nginx thêm CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; không để lộ phiên bản Nginx.
- Promtail đọc Docker API qua socket proxy chỉ bật `CONTAINERS`, `EVENTS`, `NETWORKS`, `PING`, `VERSION`, chặn POST. Docker socket vẫn là tài nguyên nhạy cảm; không expose proxy ra host hoặc mạng không tin cậy.
- Các endpoint quản trị chỉ phù hợp demo cục bộ. Khi triển khai Internet cần HTTPS (TLS certificate), xác thực/ủy quyền, rate limiting, quản lý secret, backup và kiểm thử bảo mật bổ sung.

## 8. Dừng, reset dữ liệu và xử lý lỗi

```powershell
docker compose down
```

Để xóa toàn bộ dữ liệu demo (bao gồm database, dashboard state và log), xác nhận đang ở đúng project rồi chạy:

```powershell
docker compose down -v
```

Database init chỉ chạy lần đầu khi volume MySQL rỗng. Nếu vừa sửa `database/init.sql` hoặc exporter init script, xóa volume demo như trên rồi chạy lại. Kiểm tra lỗi:

```powershell
docker compose logs --tail 100 db app nginx mysql-exporter promtail loki
docker compose config
```

## 9. Cấu trúc repository

```text
app/                  Express app, giao diện, Dockerfile
database/             Schema, dữ liệu demo, tạo tài khoản exporter
nginx/                Reverse proxy và security headers
monitoring/           Prometheus, Grafana provisioning và dashboard
logging/              Loki và Promtail
docs/BAO-CAO.html     Báo cáo A4 có thể in/xuất PDF
docker-compose.yml    Toàn bộ dịch vụ và network/volume
.env.example          Mẫu cấu hình, không chứa secret sử dụng thật
```

## 10. GitHub và ba mốc commit của đề

1. `feat: deploy ticketing app with mysql and nginx reverse proxy` — ứng dụng, DB, phpMyAdmin, Nginx.
2. `feat: add prometheus and grafana monitoring` — exporters, Prometheus, dashboard.
3. `feat: add loki log stack and security hardening` — Loki/Promtail, hardening, tài liệu/báo cáo.

Tạo repository GitHub với tên mã sinh viên, sau đó đặt remote và push:

```powershell
git remote add origin https://github.com/<TEN_TAI_KHOAN>/<MA_SO_SINH_VIEN>.git
git push -u origin main
```

Không đưa `.env`, mật khẩu hoặc dữ liệu khách hàng thật vào commit. Điền mã sinh viên, họ tên, lớp, giảng viên và trường vào bìa [báo cáo](docs/BAO-CAO.html); chụp ảnh website, phpMyAdmin, dashboard, Prometheus Targets và LogQL sau khi stack chạy để thay các ô minh chứng trong báo cáo.
