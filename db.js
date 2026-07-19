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
  subgroup TEXT DEFAULT '',
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

  const u = db.prepare('INSERT INTO users (user_code,password_hash,name,role,department_id,must_change_password) VALUES (?,?,?,?,?,0)');
  u.run('ADMIN001', hash, 'ผู้ดูแลระบบ', 'admin', meId);
  u.run('OFF001', hash, 'นางสาวเจ้าหน้าที่ งานทะเบียน', 'officer', meId);
  u.run('LEC001', hash, 'อ.ประวิทย์ เครื่องกลดี', 'lecturer', meId);
  u.run('CON001', hash, 'อ.แนะแนว ใส่ใจ', 'counselor', meId);
  u.run('65010001', hash, 'นายสมชาย ใจดี', 'student', meId);
  u.run('65010002', hash, 'นางสาวสมหญิง เรียนเก่ง', 'student', meId);

  const c = db.prepare('INSERT INTO courses (code,name,credits,category,subgroup,department_id) VALUES (?,?,?,?,?,?)');

  // ===== หมวดวิชาศึกษาทั่วไป (ฉบับปรับปรุง พ.ศ. 2568) ไม่น้อยกว่า 24 น.ก. =====
  const GE = [
    ['ภาษาอังกฤษ (ไม่น้อยกว่า 9 น.ก.)', [
      ['1001112','ภาษาอังกฤษพื้นฐาน (บังคับ 1)',3],
      ['1001113','ทักษะการอ่านและการเขียนภาษาอังกฤษ (บังคับ 2)',3],
      ['1001214','ทักษะการนำเสนอเป็นภาษาอังกฤษ',3],
      ['1001215','ภาษาอังกฤษก้าวสู่โลกการทำงาน',3],
      ['1001216','ข้อสอบมาตรฐานวัดความสามารถด้านภาษาอังกฤษ',3],
      ['1001217','การแปลภาษาอังกฤษในโลกดิจิทัล',3],
      ['1001218','ภาษาอังกฤษเพื่อการประกอบอาชีพ',3],
      ['1001219','ภาษาอังกฤษแนวบันเทิง',3]]],
    ['ภาษาต่างประเทศอื่น', [
      ['1001220','ภาษาจีนในชีวิตประจำวัน',3],
      ['1001221','ภาษาญี่ปุ่นในชีวิตประจำวัน',3],
      ['1001222','ภาษาเยอรมันในชีวิตประจำวัน',3],
      ['1001223','ภาษาพม่าในชีวิตประจำวัน',3]]],
    ['ภาษาไทย (ไม่น้อยกว่า 3 น.ก.)', [
      ['1001124','ภาษาไทยเพื่อชีวิตประจำวันในบริบทไทย (นานาชาติ)',3],
      ['1001125','การใช้ภาษาไทยเพื่อการสื่อสาร (นักศึกษาไทย)',3],
      ['1001126','สุนทรียศาสตร์ของภาษาในบทเพลง',3],
      ['1001127','เกมกลภาษา วัฒนธรรมล้ำสมัย',3],
      ['1001128','ภาษาไทยในเรื่องเล่าท้องถิ่น',3]]],
    ['จริยธรรมและการเป็นพลเมืองที่เข้มแข็ง (ไม่น้อยกว่า 3 น.ก.)', [
      ['1002115','สังคมศาสตร์บูรณาการ',3],
      ['1002116','การเมืองเรื่องใกล้ตัว',3],
      ['1002117','รู้รอบกฎหมาย',3],
      ['1002118','เศรษฐศาสตร์สำหรับชีวิตประจำวัน',3],
      ['1002119','อาเซียนศึกษา',3],
      ['1002220','ความเป็นพลเมืองยุคใหม่',3],
      ['1002221','ตระหนักรู้สู้ทุจริต',3],
      ['1002122','กีฬา และสุขภาพ',3]]],
    ['ทักษะการเรียนรู้สื่อและการปรับตัวในยุคดิจิทัล (ไม่น้อยกว่า 3 น.ก.)', [
      ['1002123','มนุษย์กับการดำเนินชีวิต',3],
      ['1002124','อยู่อย่างเป็นสุขในสังคมที่หลากหลาย',3],
      ['1002125','การจัดการชีวิตและการทำงาน',3],
      ['1002126','การดำเนินชีวิตในยุคดิจิทัล',3],
      ['1002227','สุนทรียศาสตร์ในการดำเนินชีวิต',3]]],
    ['ทักษะการคิดเพื่อสร้างสรรค์นวัตกรรม (ไม่น้อยกว่า 3 น.ก.)', [
      ['1003109','คณิตศาสตร์สำหรับชีวิตประจำวัน',3],
      ['1003110','การคิดและการตัดสินใจ',3],
      ['1003111','เทคโนโลยีสารสนเทศและการสื่อสาร',3],
      ['1003212','วิทยาศาสตร์และเทคโนโลยีเพื่ออนาคต',3],
      ['1003213','สิ่งแวดล้อมและภูมิอากาศในชีวิตประจำวัน',3],
      ['1003114','ปัญญาประดิษฐ์สร้างสรรค์และการประยุกต์ใช้',3]]],
    ['ทักษะการเป็นผู้ประกอบการ (ไม่น้อยกว่า 3 น.ก.)', [
      ['1003115','ทักษะการเป็นผู้ประกอบการ',3],
      ['1003216','รู้รอบเรื่องการเงิน',3]]]
  ];
  for (const [sub, list] of GE) for (const [code, name, cr] of list) c.run(code, name, cr, 'general', sub, meId);

  // ===== หมวดวิชาเฉพาะ ไม่น้อยกว่า 97 น.ก. =====
  const CORE = [
    ['พื้นฐานทางวิทยาศาสตร์และคณิตศาสตร์ (15 น.ก.)', [
      ['2000101','คณิตศาสตร์ 1',3],['2000102','เคมี 1',3],['2000103','ฟิสิกส์ 1',3],
      ['2000104','ฟิสิกส์ 2',3],['2000105','คณิตศาสตร์ 2',3]]],
    ['พื้นฐานทางวิศวกรรม (19 น.ก.)', [
      ['2000106','เขียนแบบ',3],['2000107','การเขียนโปรแกรมคอมพิวเตอร์',3],
      ['2004101','เทอร์โมไดนามิกส์',3],['2004201','วัสดุวิศวกรรม',3],
      ['2004202','สถิตยศาสตร์',3],['2004203','การฝึกพื้นฐานทางวิศวกรรม',1],
      ['2004204','กลศาสตร์ของวัสดุ',3]]],
    ['วิชาบังคับทางวิศวกรรม (45 น.ก.)', [
      ['2004205','ปฏิบัติการวิศวกรรมเครื่องกล 1',1],['2004206','กลศาสตร์ของไหล',3],
      ['2004207','กรรมวิธีการผลิต',3],['2004208','พลศาสตร์สำหรับวิศวกรรมเครื่องกล',3],
      ['2004209','เทคโนโลยีสมัยใหม่',3],
      ['2004301','การสั่นสะเทือนทางกล',3],['2004302','การถ่ายเทความร้อน',3],
      ['2004303','กลศาสตร์เครื่องจักรกล',3],['2004304','ปฏิบัติการวิศวกรรมเครื่องกล 2',1],
      ['2004305','อาชีวอนามัย ความปลอดภัย และสิ่งแวดล้อม',3],['2004306','การออกแบบเครื่องจักรกล',3],
      ['2004307','การออกแบบงานวิศวกรรมเครื่องกลด้วยคอมพิวเตอร์',3],
      ['2004308','ระบบเชิงพลวัต และการควบคุมอัตโนมัติ',3],['2004309','การทำความเย็นและการปรับอากาศ',3],
      ['2004310','วิศวกรรมโรงจักรต้นกำลัง',3],['2004311','ปฏิบัติการวิศวกรรมเครื่องกล 3',1],
      ['2004403','การจัดการพลังงานและสิ่งแวดล้อม',3],['2004320','การฝึกงานวิศวกรรม',0]]],
    ['บังคับเลือก: โครงงาน / สหกิจศึกษา (9 น.ก.)', [
      ['2004312','สัมมนาโครงงานวิศวกรรมเครื่องกล',3],['2004401','โครงงานวิศวกรรมเครื่องกล 1',3],
      ['2004402','โครงงานวิศวกรรมเครื่องกล 2',3],['2004404','การเตรียมสหกิจศึกษา',3],
      ['2004405','สหกิจศึกษา',6]]],
    ['วิชาเลือกทางวิศวกรรมเครื่องกล (ไม่น้อยกว่า 9 น.ก.)', [
      ['2004421','เทคโนโลยีซีเอ็นซี',3],['2004422','วิศวกรรมยานยนต์',3],
      ['2004423','การวิเคราะห์เชิงตัวเลขสำหรับวิศวกรรมเครื่องกล',3],['2004424','การบำรุงรักษาเครื่องจักรกล',3],
      ['2004425','การออกแบบระบบเครื่องจักรกล',3],['2004426','เครื่องจักรกลของไหล',3],
      ['2004427','การออกแบบระบบท่อ',3],['2004428','อากาศพลศาสตร์',3],
      ['2004429','การปรับอากาศและระบายอากาศ',3],['2004430','การออกแบบระบบทางความร้อน',3],
      ['2004431','การควบคุมกำลังของของไหล',3],['2004432','วิธีการไฟไนต์เอลิเมนต์สำหรับวิศวกรรมเครื่องกล',3],
      ['2004433','พลังงานทางเลือกและพลังงานหมุนเวียน',3],['2004434','การจัดการพลังงานและของเสีย',3],
      ['2004435','เทคโนโลยีสะอาดเบื้องต้น',3],['2004436','วิศวกรรมไฟฟ้าเบื้องต้น',3],
      ['2004437','ระบบเครื่องกลในอาคาร',3],['2004438','พื้นฐานผู้รับผิดชอบพลังงาน',3],
      ['2004439','ระบบกักเก็บพลังงานและการประยุกต์ใช้งาน',3],
      ['2004440','เศรษฐศาสตร์และแบบจำลองธุรกิจทางพลังงานใหม่',3],
      ['2004441','เทคโนโลยีของแบตเตอรี่ขั้นแนะนำ',3],
      ['2004442','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 1',3],['2004443','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 2',3],
      ['2004444','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 3',3],['2004445','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 4',3],
      ['2004446','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 5',3],['2004447','หัวข้อพิเศษทางวิศวกรรมเครื่องกล 6',3]]]
  ];
  for (const [sub, list] of CORE) for (const [code, name, cr] of list) c.run(code, name, cr, 'core', sub, meId);

  // ===== หมวดวิชาเลือกเสรี 6 น.ก. (เพิ่มรายวิชาผ่านหน้าจัดการหลักสูตร) =====

  const semId = db.prepare('INSERT INTO semesters (term,year,is_current,registration_open,created_by) VALUES (1,2569,1,1,1)').run().lastInsertRowid;
  const idOf = code => db.prepare('SELECT id FROM courses WHERE code=?').get(code).id;
  const o = db.prepare(`INSERT INTO offerings (semester_id,course_id,lecturer_name,day,start_time,end_time,room,capacity,status,requested_by) VALUES (?,?,?,?,?,?,?,?, 'active', 1)`);
  o.run(semId, idOf('2000101'), 'อ.ประวิทย์ เครื่องกลดี', 1, '09:00', '12:00', 'EN301', 40);
  o.run(semId, idOf('1001112'), 'อ.แอนนา สมิธ', 2, '09:00', '12:00', 'GE101', 60);
  o.run(semId, idOf('1003110'), 'อ.สุภาพร คิดดี', 3, '13:00', '16:00', 'GE205', 60);
  o.run(semId, idOf('2000106'), 'อ.ธีรพงษ์ แข็งแรง', 5, '09:00', '12:00', 'EN105', 40);
  console.log('Seeded database (หลักสูตรจริง ม.ชินวัตร: GE 2568 + วิศวกรรมเครื่องกล)');
}
seed();

module.exports = db;
