PRAGMA defer_foreign_keys=TRUE;

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT
);

CREATE TABLE IF NOT EXISTS login_logs (
  ip_address TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 1,
  last_attempt INTEGER
);

CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  distance REAL,
  moving_time INTEGER,
  total_elevation_gain REAL,
  average_speed REAL,
  max_speed REAL,
  polyline TEXT,
  activity_type TEXT DEFAULT 'ride',
  participants TEXT,
  avg_temp REAL,
  source TEXT DEFAULT NULL,
  planned_route_id INTEGER,
  is_public INTEGER DEFAULT 0,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS planned_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  distance REAL DEFAULT 0,
  duration INTEGER DEFAULT 0,
  route_url TEXT NOT NULL,
  provider TEXT DEFAULT 'ors',
  profile TEXT DEFAULT 'cycling-regular',
  waypoints TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS personal_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'ride',
  source_ride_id INTEGER,
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  end_lat REAL NOT NULL,
  end_lng REAL NOT NULL,
  start_index INTEGER,
  end_index INTEGER,
  distance_km REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planned_routes_created_at
  ON planned_routes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_planned_routes_provider
  ON planned_routes (provider);

CREATE INDEX IF NOT EXISTS idx_personal_segments_activity
  ON personal_segments (activity_type, created_at);
