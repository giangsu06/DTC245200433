CREATE DATABASE IF NOT EXISTS cinema
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE cinema;

CREATE TABLE IF NOT EXISTS movies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  genre VARCHAR(80) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  poster_emoji VARCHAR(12) NOT NULL DEFAULT '🎬',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS screenings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  movie_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  room_name VARCHAR(80) NOT NULL,
  seat_capacity SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  ticket_price DECIMAL(10, 2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_screenings_movie FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE CASCADE,
  INDEX idx_screenings_starts_at (starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screening_id BIGINT UNSIGNED NOT NULL,
  seat_number SMALLINT UNSIGNED NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  payment_status ENUM('simulated_paid') NOT NULL DEFAULT 'simulated_paid',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_bookings_screening FOREIGN KEY (screening_id) REFERENCES screenings (id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_booking_screening_seat (screening_id, seat_number),
  INDEX idx_bookings_created_at (created_at)
) ENGINE=InnoDB;

INSERT INTO movies (id, title, description, genre, duration_minutes, poster_emoji) VALUES
  (1, 'Hành trình ngân hà', 'Một phi hành đoàn trẻ khám phá tín hiệu bí ẩn ngoài rìa vũ trụ.', 'Khoa học viễn tưởng', 124, '🚀'),
  (2, 'Mùa hè rực rỡ', 'Những người bạn cũ gặp lại nhau trong chuyến đi về miền biển.', 'Tình cảm', 108, '🌅'),
  (3, 'Bí ẩn căn phòng 13', 'Một nhà báo lần theo manh mối trong khách sạn bị bỏ hoang.', 'Trinh thám', 116, '🕵️')
ON DUPLICATE KEY UPDATE title = VALUES(title);

INSERT INTO screenings (id, movie_id, starts_at, room_name, seat_capacity, ticket_price) VALUES
  (1, 1, DATE_ADD(NOW(), INTERVAL 2 HOUR), 'Phòng 1', 40, 95000.00),
  (2, 2, DATE_ADD(NOW(), INTERVAL 4 HOUR), 'Phòng 2', 40, 85000.00),
  (3, 3, DATE_ADD(NOW(), INTERVAL 6 HOUR), 'Phòng 3', 40, 90000.00),
  (4, 1, DATE_ADD(NOW(), INTERVAL 1 DAY), 'Phòng 1', 40, 95000.00)
ON DUPLICATE KEY UPDATE movie_id = VALUES(movie_id);
