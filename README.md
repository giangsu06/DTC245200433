# Rạp Mây — nền tảng đặt vé xem phim

Đồ án triển khai website đặt vé xem phim/sự kiện bằng Docker Compose: Express + MySQL + phpMyAdmin, Nginx reverse proxy, Prometheus + Grafana, Loki + Grafana Alloy và các cấu hình hardening cơ bản.

> Thanh toán chỉ là **mô phỏng** để phục vụ demo. Không nhập dữ liệu thẻ hoặc thông tin thanh toán thật.

## 1. Kiến trúc

```text
Trình duyệt
   ├── https://localhost:18443 ── Nginx TLS reverse proxy + security headers ── Express
   ├── http://localhost:18080 ── Nginx → chuyển hướng HTTPS
   │                                                                       └── MySQL
   ├── http://localhost:18081 ── phpMyAdmin ──────────────────────────────────┘
   └── http://localhost:13000 ── Grafana ── Prometheus / Loki
                                           ├── cAdvisor (metrics container)
                                           ├── MySQL exporter
                                           ├── Nginx exporter
                                           └── Grafana Alloy (Docker logs) ── Loki
```

Các cổng giao diện quản trị được bind vào `127.0.0.1`; MySQL và Loki không publish cổng ra host. Mạng `data` và `observability` là mạng nội bộ; `management` chỉ nối phpMyAdmin/Grafana tới các cổng host cục bộ. Alloy chỉ đọc metadata/log qua Docker socket proxy với API chỉ bật các quyền cần cho discovery và events.

## 2. Yêu cầu

- Docker Desktop với Linux containers và Docker Compose v2.
- Windows 10/11, macOS hoặc Linux.
- RAM khuyến nghị tối thiểu 6 GB cho toàn bộ stack.

### Cài Docker Desktop

Tải và cài Docker Desktop từ [trang Docker Desktop chính thức](https://www.docker.com/products/docker-desktop/). Trên Windows, bật backend WSL 2 nếu trình cài đặt yêu cầu, mở Docker Desktop và đợi Docker Engine chạy. Xác nhận trong PowerShell:

```powershell
docker version
docker compose version
```

> cAdvisor cần Docker Engine có hỗ trợ mount `/sys`, `/var/lib/docker` và `/var/run`. Trên Docker Desktop, một số chỉ số host/container có thể khác hoặc không khả dụng như trên Linux.

## 3. Khởi chạy trên Windows PowerShell

Mở PowerShell tại thư mục project:

```powershell
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
} else {
    Write-Host ".env đã tồn tại; giữ nguyên để bảo vệ cấu hình hiện tại."
}
notepad .env
```

Thay **tất cả** giá trị `ReplaceWithLongRandom...` bằng mật khẩu ngẫu nhiên riêng, dài ít nhất 32 ký tự; chỉ dùng chữ và số cho MySQL/Grafana, và chữ, số, dấu gạch dưới hoặc gạch ngang cho `MYSQL_EXPORTER_PASSWORD`. Không đưa `.env` lên GitHub.

Tạo chứng chỉ tự ký dành riêng cho localhost (cần OpenSSL; Git for Windows thường đã cài sẵn):

```powershell
.\nginx\ssl\generate-local-cert.ps1
```

Chứng chỉ và private key được tạo trong `nginx\ssl\` nhưng bị Git ignore. Chứng chỉ có CN/SAN `localhost`, có hiệu lực 365 ngày. Đây là chứng chỉ demo tự ký nên trình duyệt có thể cảnh báo **Not secure**; chỉ tiếp tục cho địa chỉ localhost. Không tái sử dụng chứng chỉ/private key này trên máy chủ public.

```powershell
docker compose config
docker compose up -d --build
docker compose ps
```

Đợi các service `healthy`/`running`, sau đó truy cập:

| Thành phần | Địa chỉ |
|---|---|
| Website qua Nginx HTTPS | <https://localhost:18443> |
| Website HTTP (chuyển hướng HTTPS) | <http://localhost:18080> |
| phpMyAdmin | <http://localhost:18081> |
| Grafana | <http://localhost:13000> |
| Prometheus | <http://localhost:19090> |
| Health check ứng dụng | <http://localhost:18080/healthz> |

Các cổng trên khớp với cấu hình `.env` hiện tại. Nếu đổi `CINEMA_WEB_PORT`, `CINEMA_HTTPS_PORT`, `CINEMA_PMA_PORT`, `CINEMA_GRAFANA_PORT` hoặc `CINEMA_PROMETHEUS_PORT`, hãy cập nhật lại địa chỉ truy cập tương ứng.
Đăng nhập phpMyAdmin bằng `MYSQL_USER` / `MYSQL_PASSWORD` trong `.env`. Đăng nhập Grafana bằng `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`. Dashboard **Cinema platform overview** và hai data source Prometheus/Loki được provision tự động.

Theo dõi trạng thái/log:

```powershell
docker compose ps
docker compose logs -f app nginx db prometheus grafana loki alloy
```

## 4. Demo chức năng đặt vé

1. Mở website, chọn phim và suất chiếu; sơ đồ ghế hiển thị theo hàng, có phân biệt ghế trống, ghế đang chọn và ghế đã đặt.
2. Chọn tối đa 8 ghế, nhập họ tên và email nhận vé. Tổng tiền được cập nhật theo số ghế.
3. Kiểm tra lại phim, giờ chiếu, phòng, ghế, email và tổng tiền ở bước thanh toán demo; quay lại để chỉnh sửa nếu cần.
4. Bấm **Xác nhận thanh toán demo** để tạo vé. Đây chỉ là mô phỏng, không thu tiền, không kết nối ngân hàng và không yêu cầu dữ liệu thẻ.
5. Ghi lại mã vé, trạng thái thanh toán mô phỏng và danh sách ghế trong xác nhận thành công.
6. Đóng hộp thoại, chọn lại suất chiếu: ghế vừa đặt hiển thị đã có người chọn.
7. Kiểm tra bảng `movies`, `screenings`, `bookings` trong phpMyAdmin.
8. Tranh chấp đặt cùng một ghế được bảo vệ bằng transaction khóa lịch chiếu và unique key `(screening_id, seat_number)`.

## 5. Kiểm thử nghiệp vụ giai đoạn 1

Chạy `docker compose ps` và xác nhận `db`/`app` healthy trước khi kiểm thử. Các URL dưới đây dùng cổng hiện tại; nếu đổi `.env`, thay cổng tương ứng.

| Bước | Thao tác | Kết quả mong đợi |
|---|---|---|
| Health và DB | Mở `https://localhost:18443/healthz` | HTTP 200, JSON có `status: ok` và `database: connected`. |
| Danh sách phim/suất | Mở `https://localhost:18443/api/movies` | JSON có tên, mô tả, thể loại, thời lượng, phòng, giờ chiếu, giá và số ghế còn trống. |
| Ghế | Mở `https://localhost:18443/api/screenings/1/seats` | Danh sách ghế có trạng thái `booked`; ghế đặt trước bị vô hiệu hóa trên giao diện. |
| Luồng thanh toán demo | Chọn ghế, nhập tên/email, kiểm tra trang tổng kết rồi xác nhận demo | Chưa tạo vé trước khi xác nhận; sau xác nhận HTTP 201, hộp thoại có mã `RM-...`, phim, giờ chiếu, ghế, tổng tiền và thông báo không thu tiền thật. |
| Đầu vào sai | Gửi email sai, không chọn ghế, ghế ngoài sức chứa hoặc trên 8 ghế | Bị từ chối; không tạo bản ghi đặt vé. |
| Đặt trùng đồng thời | Gửi hai yêu cầu cùng suất và cùng ghế trống gần như đồng thời | Một yêu cầu HTTP 201; yêu cầu còn lại HTTP 409; chỉ có một bản ghi cho cặp suất/ghế. |
| DB tool | Đăng nhập phpMyAdmin và xem `movies`, `screenings`, `bookings` | Dữ liệu mẫu hiện diện; đặt vé mới xuất hiện trong `bookings`. |

Có thể kiểm tra đặt vé thủ công trong trình duyệt; không dùng thông tin cá nhân hoặc thanh toán thật. Mã xác nhận `RM-...` được tạo từ ID bản ghi MySQL đầu tiên trong transaction.

## 6. Giám sát Prometheus/Grafana

Prometheus scrape các target `prometheus`, `cinema-app`, `mysql`, `nginx`, `containers` mỗi 15 giây. Trong Prometheus, mở <http://localhost:19090/targets> và xác nhận target `UP`. Dashboard **Cinema platform overview** được provision tự động tại Grafana <http://localhost:13000/d/cinema-overview/cinema-platform-overview>; dashboard hiển thị request theo method/status, p95 thời gian phản hồi, booking thành công, CPU/RAM container, trạng thái/kết nối MySQL và kết nối Nginx.

| Job | Target nội bộ | Metric tiêu biểu | Kiểm tra |
|---|---|---|---|
| `prometheus` | `prometheus:9090` | `up`, `prometheus_tsdb_head_samples_appended_total` | Status → Targets; `up{job="prometheus"}` |
| `cinema-app` | `app:3000/metrics` | `cinema_http_requests_total`, `cinema_http_request_duration_seconds`, `cinema_bookings_created_total` | `up{job="cinema-app"}` và PromQL bên dưới |
| `mysql` | `mysql-exporter:9104` | `mysql_up`, `mysql_global_status_threads_connected`, `mysql_global_status_queries` | `up{job="mysql"}` và `mysql_up` |
| `nginx` | `nginx-exporter:9113` | `nginx_connections_active`, `nginx_connections_accepted` | `up{job="nginx"}` |
| `containers` | `cadvisor:8080` | `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` | `up{job="containers"}` |

MySQL exporter dùng file cấu hình chỉ đọc với biến môi trường lấy từ `.env` (đã loại khỏi Git); mật khẩu không được ghi trực tiếp trong file cấu hình hoặc log. Kiểm tra kết nối thực tế bằng `mysql_up` và `mysql_global_status_threads_connected`.

Một số biểu thức PromQL có thể dùng ở Grafana Explore:

```promql
sum by (method, status) (rate(cinema_http_requests_total[5m]))
histogram_quantile(0.95, sum by (le) (rate(cinema_http_request_duration_seconds_bucket[5m])))
sum(cinema_bookings_created_total)
100 * rate(container_cpu_usage_seconds_total{name!=""}[5m])
container_memory_working_set_bytes{name!=""}
mysql_up
mysql_global_status_threads_connected
nginx_connections_active
```

Tạo lưu lượng bằng cách tải trang và đặt thử một vé để các biểu đồ bắt đầu có dữ liệu. Một số chỉ số cAdvisor/MySQL exporter phụ thuộc runtime và phiên bản Docker/MySQL.

Để chụp minh chứng, mở **Prometheus → Status → Targets** và chụp các job có trạng thái `UP`; sau đó mở URL dashboard Grafana ở trên, chọn khoảng thời gian **Last 15 minutes**, và chụp toàn dashboard sau khi tạo request/booking demo. Không để lộ thông tin đăng nhập hay dữ liệu khách thật.

## 7. Loki và LogQL

Promtail đã hết vòng đời upstream từ tháng 3/2026; stack dùng **Grafana Alloy 1.21.2**, collector kế nhiệm có Docker discovery và đọc log qua Docker Engine API. Cơ chế này tránh phụ thuộc trực tiếp vào đường dẫn log nội bộ Docker Desktop trên Windows. Pipeline:

```text
Docker Engine API → socket proxy (read-only API) → Alloy discovery/source
  → lọc log cũ hơn 7 ngày, parse level JSON → Loki (volume, retention 7 ngày)
  → Grafana datasource Loki (provisioned) → Explore / LogQL
```

Alloy thu thập app, Nginx, MySQL, phpMyAdmin, exporters, cAdvisor, Prometheus, Grafana và Loki; bỏ qua socket proxy/Alloy để tránh log nhiễu và vòng lặp. Mọi container dùng Docker `json-file` rotation tối đa 10 MB × 3 file. Ứng dụng và Nginx ghi JSON ra stdout/stderr. Log request chỉ chứa timestamp, mức độ, service, method, route không có query string, status, thời gian xử lý và request ID; không ghi IP, request body, tên/email khách hàng, token hay dữ liệu thanh toán.

Trong Grafana chọn **Explore → Loki** (`http://localhost:13000/explore`), datasource **Loki**, thời gian **Last 15 minutes**. Các truy vấn sau đã đối chiếu với labels `project`, `service`, `container`, `level`:

```logql
{project="cinema-platform", service="cinema-app"}
{project="cinema-platform", service="cinema-app"} | json | event="http_request" | method="POST" | route="/api/bookings"
{project="cinema-platform", service="cinema-app"} | json | status >= 400
{project="cinema-platform", service="cinema-app", level="error"}
```

Các truy vấn lần lượt xem log ứng dụng, lọc POST đặt vé, lọc lỗi HTTP 4xx/5xx và lọc lỗi ứng dụng. Để demo, tải website, gửi booking hợp lệ, gửi booking với email sai (HTTP 400), rồi đặt lại ghế vừa đặt (HTTP 409). Trong Explore chạy các truy vấn trên; kỳ vọng thấy event `http_request` mức `info`, `warn` cùng status/route tương ứng. Dùng request ID trong JSON để đối chiếu cùng request giữa app và Nginx.

Để chụp minh chứng, chụp Grafana Explore với datasource Loki, một truy vấn và các dòng kết quả có labels `service`/`container` cùng status 201/400/409; không để lộ dữ liệu người dùng. Loki giữ log tối đa 168 giờ; Alloy bỏ qua log cũ hơn thời hạn này. Xem collector bằng `docker compose logs --tail 50 alloy loki`.

## 8. Cấu hình bảo mật

- Các mạng `frontend`, `data`, `observability` và `management` đều đặt `internal: true`. Ứng dụng/Nginx, database/phpMyAdmin, monitoring và quản trị chỉ nối vào những mạng cần thiết; Prometheus được nối thêm vào `management` để truy cập giao diện local sau khi cô lập mạng.
- Chỉ publish website HTTP `18080`, HTTPS `18443`, phpMyAdmin `18081`, Grafana `13000` và Prometheus `19090`, tất cả bind vào `127.0.0.1`. Ứng dụng, MySQL, Loki và exporters không publish cổng ra host.
- Ứng dụng chạy bằng user `node`, filesystem chỉ đọc, bỏ Linux capabilities và bật `no-new-privileges`.
- Nginx chạy non-root (UID 101) trên cổng container 8080, filesystem chỉ đọc, bỏ capabilities và chỉ có tmpfs cần thiết.
- MySQL chạy bằng user `mysql`, filesystem chỉ đọc và chỉ giữ các capabilities cần cho entrypoint khởi tạo (`CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID`); `/tmp` và socket runtime đặt trên tmpfs. Database không publish port.
- Ứng dụng dùng tài khoản DB riêng: `SELECT` trên schema `cinema`, `INSERT` trên bảng `bookings` và `UPDATE` trên `screenings` chỉ để MySQL cho phép khóa dòng bằng `SELECT ... FOR UPDATE`; MySQL exporter dùng account chỉ có quyền metrics (`PROCESS`, `REPLICATION CLIENT`, `SELECT`). Cả hai không dùng root.
- Prometheus, Grafana, Loki, Alloy và exporters dùng filesystem chỉ đọc cùng tmpfs cần thiết; Alloy chạy UID 473. cAdvisor cần quyền đọc metadata host để thu thập metrics nên vẫn là ngoại lệ về user, nhưng không publish port và đã bỏ capabilities.
- phpMyAdmin chỉ bind localhost và chỉ kết nối service MySQL nội bộ; image Apache của phpMyAdmin vẫn dùng entrypoint/master process mặc định, chưa ép non-root hoặc read-only vì chưa xác minh tương thích của image với các thay đổi đó. Không mở giao diện này ra Internet.
- Grafana tắt đăng ký và anonymous access; cổng quản trị chỉ bind `127.0.0.1`.
- Nginx thêm CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; không để lộ phiên bản Nginx.
- Alloy đọc Docker API qua socket proxy chỉ bật quyền đọc `CONTAINERS`, `EVENTS`, `NETWORKS`, `PING`, `VERSION`, chặn POST. Docker socket vẫn là tài nguyên nhạy cảm; không expose proxy ra host hoặc mạng không tin cậy.
- Docker log dùng rotation `10m` × 3 file; API giới hạn JSON body 20 KB và Nginx giới hạn request body 1 MB. Chưa đặt CPU/memory quota cho container; cần hiệu chỉnh theo tài nguyên máy trước khi triển khai tải thực.
- Mật khẩu lấy từ `.env` cục bộ (được `.gitignore` loại trừ), không ghi vào file cấu hình được commit. `.env.example` chỉ chứa tên biến/giá trị hướng dẫn; khi chạy production nên dùng Docker secrets hoặc secret manager.
- HTTPS local dùng chứng chỉ tự ký; trình duyệt sẽ không đánh dấu chứng chỉ này là tin cậy nếu chưa cài CA phù hợp. Các endpoint quản trị chỉ phù hợp demo cục bộ. Khi triển khai Internet cần chứng chỉ TLS từ CA tin cậy, xác thực/ủy quyền, rate limiting, quản lý secret, backup và kiểm thử bảo mật bổ sung.

## 9. Dừng, reset dữ liệu và xử lý lỗi

```powershell
docker compose down
```

Để xóa toàn bộ dữ liệu demo (bao gồm database, dashboard state và log), xác nhận đang ở đúng project rồi chạy:

```powershell
docker compose down -v
```

Database init chỉ chạy lần đầu khi volume MySQL rỗng. Nếu vừa sửa `database/init.sql` hoặc exporter init script, các thay đổi đó không tự chạy trên volume đã có dữ liệu; áp dụng migration tương ứng hoặc reset volume demo có chủ đích như trên. Kiểm tra lỗi:

```powershell
docker compose logs --tail 100 db app nginx mysql-exporter alloy loki
docker compose config
```

## 10. Cấu trúc repository

```text
app/                  Express app, giao diện, Dockerfile
database/             Schema, dữ liệu demo, tạo tài khoản exporter
nginx/                Reverse proxy và security headers
monitoring/           Prometheus, Grafana provisioning và dashboard
logging/              Loki và Grafana Alloy
docs/BAO-CAO.md       Báo cáo đồ án định dạng Markdown
docker-compose.yml    Toàn bộ dịch vụ và network/volume
.env.example          Mẫu cấu hình, không chứa secret sử dụng thật
```

## 11. GitHub và ba mốc commit của đề

1. `feat: deploy ticketing app with mysql and nginx reverse proxy` — ứng dụng, DB, phpMyAdmin, Nginx.
2. `feat: add prometheus and grafana monitoring` — exporters, Prometheus, dashboard.
3. `feat: add centralized logging with loki` — Loki/Alloy, LogQL, log rotation và hardening.

Tạo repository GitHub với tên mã sinh viên, sau đó đặt remote và push:

```powershell
git remote add origin https://github.com/<TEN_TAI_KHOAN>/<MA_SO_SINH_VIEN>.git
git push -u origin main
```

Không đưa `.env`, mật khẩu hoặc dữ liệu khách hàng thật vào commit. Điền mã sinh viên, họ tên, lớp, giảng viên và trường vào bìa [báo cáo Markdown](docs/BAO-CAO.md); chụp ảnh website, phpMyAdmin, dashboard, Prometheus Targets và LogQL sau khi stack chạy để thay các ô minh chứng trong báo cáo.
