const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','officer','lecturer','counselor','student')),
  department_id INTEGER REFERENCES departments(id),
  email TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  doc_type TEXT NOT NULL CHECK(doc_type IN ('application','id_card','house_reg','transcript','photo','payment_slip')),
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reason TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewed_by INTEGER,
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 3,
  category TEXT NOT NULL CHECK(category IN ('general','core','free')),
  department_id INTEGER REFERENCES departments(id),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(code, department_id)
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  src_institution TEXT,
  src_course TEXT,
  src_credits REAL,
  src_grade TEXT,
  note TEXT,
  attachment TEXT,
  recorded_by INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(student_id, course_id)
);
CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term INTEGER NOT NULL,
  year INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  registration_open INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  UNIQUE(term, year)
);
CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  lecturer_name TEXT NOT NULL,
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room TEXT,
  capacity INTEGER NOT NULL DEFAULT 40,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending_add','active','pending_delete','deleted','rejected')),
  requested_by INTEGER,
  decided_by INTEGER,
  decide_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  offering_id INTEGER NOT NULL REFERENCES offerings(id),
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK(status IN ('enrolled','withdrawn')),
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  withdrawn_by INTEGER,
  withdrawn_at TEXT,
  UNIQUE(student_id, offering_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

function seed() {
  const has = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (has > 0) return;
  const hash = bcrypt.hashSync('123456', 10);
  const dep = db.prepare('INSERT INTO departments (code,name) VALUES (?,?)');
  const meId = dep.run('ME', 'วิศวกรรมเครื่องกล').lastInsertRowid;
  dep.run('EE', 'วิศวกรรมไฟฟ้า');
  dep.run('IE', 'วิศวกรรมอุตสาหการ');

  const u = db.prepare('INSERT INTO users (user_code,password_hash,name,role,department_id,must_change_password) VALUES (?,?,?,?,?,0)');
  u.run('ADMIN001', hash, 'ผู้ดูแลระบบ', 'admin', meId);
  u.run('OFF001', hash, 'นางสาวเจ้าหน้าที่ งานทะเบียน', 'officer', meId);
  u.run('LEC001', hash, 'อ.ประวิทย์ เครื่องกลดี', 'lecturer', meId);
  u.run('CON001', hash, 'อ.แนะแนว ใส่ใจ', 'counselor', meId);
  u.run('65010001', hash, 'นายสมชาย ใจดี', 'student', meId);
  u.run('65010002', hash, 'นางสาวสมหญิง เรียนเก่ง', 'student', meId);

  const c = db.prepare('INSERT INTO courses (code,name,credits,category,department_id) VALUES (?,?,?,?,?)');
  const GE = [
    ['1001112','ภาษาอังกฤษพื้นฐาน'],['1001113','ทักษะการอ่านและการเขียนภาษาอังกฤษ'],
    ['1001215','ภาษาอังกฤษก้าวสู่โลกการทำงาน'],['1001218','ทักษะการพูดอังกฤษพื้นฐาน'],
    ['1001125','การใช้ภาษาไทยเพื่อการสื่อสาร'],['1002117','รู้รอบกฎหมาย'],
    ['1002118','เศรษฐศาสตร์ในชีวิตประจำวัน'],['1002119','อาเซียนศึกษา'],
    ['1002122','กีฬาและสุขภาพ'],['1002123','มนุษย์กับการดำเนินชีวิต'],
    ['1002124','อยู่อย่างเป็นสุขในสังคมที่หลากหลาย'],['1002126','การดำเนินชีวิตในยุคดิจิทัล'],
    ['1003109','คณิตศาสตร์สำหรับชีวิตประจำวัน'],['1003110','การคิดและการตัดสินใจ'],
    ['1003114','ปัญญาประดิษฐ์สร้างสรรค์และการประยุกต์ใช้'],['1003115','ทักษะการเป็นผู้ประกอบการ'],
    ['1003212','วิทยาศาสตร์และเทคโนโลยีเพื่ออนาคต']
  ];
  GE.forEach(([code,name]) => c.run(code, name, 3, 'general', meId));
  const CORE = [
    ['2101101','เขียนแบบวิศวกรรม'],['2101102','กลศาสตร์วิศวกรรม'],['2101103','วัสดุวิศวกรรม'],
    ['2101201','เทอร์โมไดนามิกส์'],['2101202','กลศาสตร์ของไหล'],['2101203','กลศาสตร์วัสดุ'],
    ['2101301','การถ่ายเทความร้อน'],['2101302','การออกแบบเครื่องจักรกล'],['2101303','การสั่นสะเทือนเชิงกล'],
    ['2101401','วิศวกรรมโรงจักรต้นกำลัง'],['2101402','การทำความเย็นและปรับอากาศ']
  ];
  CORE.forEach(([code,name]) => c.run(code, name, 3, 'core', meId));
  c.run('9000101','นวัตกรรมและความคิดสร้างสรรค์',3,'free',meId);
  c.run('9000102','การจัดการพลังงานเบื้องต้น',3,'free',meId);

  const semId = db.prepare('INSERT INTO semesters (term,year,is_current,registration_open,created_by) VALUES (1,2569,1,1,1)').run().lastInsertRowid;
  const idOf = code => db.prepare('SELECT id FROM courses WHERE code=?').get(code).id;
  const o = db.prepare(`INSERT INTO offerings (semester_id,course_id,lecturer_name,day,start_time,end_time,room,capacity,status,requested_by) VALUES (?,?,?,?,?,?,?,?, 'active', 1)`);
  o.run(semId, idOf('2101102'), 'อ.ประวิทย์ เครื่องกลดี', 1, '09:00', '12:00', 'EN301', 40);
  o.run(semId, idOf('1003110'), 'อ.สุภาพร คิดดี', 3, '13:00', '16:00', 'GE205', 60);
  o.run(semId, idOf('2101203'), 'อ.ธีรพงษ์ แข็งแรง', 5, '09:00', '12:00', 'EN105', 40);
  o.run(semId, idOf('1001112'), 'อ.แอนนา สมิธ', 2, '09:00', '12:00', 'GE101', 60);
  console.log('Seeded database with demo data');
}
seed();

module.exports = db;
