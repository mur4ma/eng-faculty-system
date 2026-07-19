const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'eng-faculty-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('รับเฉพาะไฟล์ PDF, JPG, PNG เท่านั้น'), ok);
  }
});

const DOC_TYPES = { application: 'ใบสมัคร', id_card: 'สำเนาบัตรประชาชน', house_reg: 'สำเนาทะเบียนบ้าน', transcript: 'ทรานสคริป', photo: 'รูปถ่าย', payment_slip: 'สลิปเงินค่าสมัคร' };
const DAYS = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };

function log(userId, action, detail) {
  db.prepare('INSERT INTO audit_log (user_id,action,detail) VALUES (?,?,?)').run(userId || null, action, detail || '');
}
function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').run(userId, message);
}
function notifyRole(role, message) {
  db.prepare("SELECT id FROM users WHERE role=? AND active=1").all(role).forEach(u => notify(u.id, message));
}
function sendEmail(to, subject, body) {
  console.log(`[EMAIL STUB] to=${to} subject=${subject} body=${body}`);
}

function auth(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (roles.length && !roles.includes(req.session.user.role)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้' });
    next();
  };
}
const STAFF = ['admin', 'officer', 'lecturer'];
const VIEWERS = ['admin', 'officer', 'lecturer', 'counselor'];

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { user_code, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE user_code=?').get((user_code || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (!user.active) return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่' });
  req.session.user = { id: user.id, user_code: user.user_code, name: user.name, role: user.role, department_id: user.department_id };
  log(user.id, 'login', user.user_code);
  res.json({ user: req.session.user, must_change_password: !!user.must_change_password });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  const u = db.prepare('SELECT must_change_password FROM users WHERE id=?').get(req.session.user.id);
  res.json({ user: req.session.user, must_change_password: !!u.must_change_password });
});
app.post('/api/change-password', auth(), (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(old_password || '', user.password_hash)) return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(new_password, 10), user.id);
  log(user.id, 'change_password', '');
  res.json({ ok: true });
});

// ---------- Users (admin/officer) ----------
app.get('/api/users', auth('admin', 'officer'), (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.user_code,u.name,u.role,u.active,u.must_change_password,d.name dept FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.role,u.user_code`).all());
});
app.post('/api/users', auth('admin', 'officer'), (req, res) => {
  const { user_code, name, role, department_id, password } = req.body || {};
  if (!user_code || !name || !role || !password) return res.status(400).json({ error: 'กรอกข้อมูลให้ครบ: รหัสผู้ใช้ ชื่อ บทบาท รหัสผ่านเริ่มต้น' });
  if (!['admin', 'officer', 'lecturer', 'counselor', 'student'].includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
  if (db.prepare('SELECT id FROM users WHERE user_code=?').get(user_code.trim())) return res.status(400).json({ error: 'รหัสผู้ใช้นี้มีอยู่แล้ว' });
  db.prepare('INSERT INTO users (user_code,password_hash,name,role,department_id,created_by,must_change_password) VALUES (?,?,?,?,?,?,1)')
    .run(user_code.trim(), bcrypt.hashSync(password, 10), name.trim(), role, department_id || null, req.session.user.id);
  log(req.session.user.id, 'create_user', `${user_code} (${role})`);
  res.json({ ok: true });
});
app.post('/api/users/:id/reset-password', auth('admin', 'officer'), (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร' });
  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  log(req.session.user.id, 'reset_password', `user#${req.params.id}`);
  res.json({ ok: true });
});
app.post('/api/users/:id/toggle-active', auth('admin', 'officer'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (u.id === req.session.user.id) return res.status(400).json({ error: 'ปิดใช้งานบัญชีตัวเองไม่ได้' });
  db.prepare('UPDATE users SET active=? WHERE id=?').run(u.active ? 0 : 1, u.id);
  log(req.session.user.id, 'toggle_active', `${u.user_code} -> ${u.active ? 'ปิด' : 'เปิด'}`);
  res.json({ ok: true });
});
app.get('/api/departments', auth(), (req, res) => res.json(db.prepare('SELECT * FROM departments').all()));
app.get('/api/students/search', auth(...VIEWERS), (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT id,user_code,name FROM users WHERE role='student' AND active=1 AND (user_code LIKE ? OR name LIKE ?) LIMIT 20`).all(q, q));
});

// ---------- Documents ----------
function docList(studentId) {
  const docs = db.prepare('SELECT * FROM documents WHERE student_id=? ORDER BY uploaded_at DESC').all(studentId);
  return Object.keys(DOC_TYPES).map(t => {
    const d = docs.find(x => x.doc_type === t);
    return { doc_type: t, label: DOC_TYPES[t], doc: d || null };
  });
}
app.get('/api/documents/mine', auth('student'), (req, res) => res.json(docList(req.session.user.id)));
app.get('/api/documents/student/:id', auth(...VIEWERS), (req, res) => res.json(docList(req.params.id)));
app.post('/api/documents/upload', auth('student'), upload.single('file'), (req, res) => {
  const { doc_type } = req.body || {};
  if (!DOC_TYPES[doc_type]) return res.status(400).json({ error: 'ประเภทเอกสารไม่ถูกต้อง' });
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์' });
  const old = db.prepare('SELECT * FROM documents WHERE student_id=? AND doc_type=?').get(req.session.user.id, doc_type);
  if (old) {
    if (old.status === 'approved') return res.status(400).json({ error: 'เอกสารนี้ผ่านการตรวจแล้ว ไม่ต้องส่งใหม่' });
    try { fs.unlinkSync(path.join(UPLOAD_DIR, old.stored_name)); } catch (e) {}
    db.prepare('DELETE FROM documents WHERE id=?').run(old.id);
  }
  db.prepare('INSERT INTO documents (student_id,doc_type,stored_name,original_name,mime) VALUES (?,?,?,?,?)')
    .run(req.session.user.id, doc_type, req.file.filename, req.file.originalname, req.file.mimetype);
  log(req.session.user.id, 'upload_document', DOC_TYPES[doc_type]);
  notifyRole('officer', `นักศึกษา ${req.session.user.name} ส่ง${DOC_TYPES[doc_type]} รอการตรวจ`);
  res.json({ ok: true });
});
app.get('/api/documents/:id/file', auth(), (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  const u = req.session.user;
  if (u.role === 'student' && d.student_id !== u.id) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูเอกสารนี้' });
  log(u.id, 'view_document', `doc#${d.id} (${DOC_TYPES[d.doc_type]}) ของ student#${d.student_id}`);
  res.sendFile(path.join(UPLOAD_DIR, d.stored_name), { headers: { 'Content-Disposition': `inline; filename="${encodeURIComponent(d.original_name)}"` } });
});
app.get('/api/documents/pending', auth('admin', 'officer'), (req, res) => {
  res.json(db.prepare(`SELECT d.*, u.user_code, u.name student_name FROM documents d JOIN users u ON u.id=d.student_id WHERE d.status='pending' ORDER BY d.uploaded_at`).all()
    .map(d => ({ ...d, label: DOC_TYPES[d.doc_type] })));
});
app.post('/api/documents/:id/review', auth('admin', 'officer'), (req, res) => {
  const { status, reason } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  if (status === 'rejected' && !reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ตีกลับ' });
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  db.prepare("UPDATE documents SET status=?, reason=?, reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?")
    .run(status, reason || null, req.session.user.id, d.id);
  log(req.session.user.id, 'review_document', `doc#${d.id} -> ${status}`);
  notify(d.student_id, status === 'approved' ? `${DOC_TYPES[d.doc_type]}ของคุณผ่านการตรวจแล้ว` : `${DOC_TYPES[d.doc_type]}ถูกตีกลับ: ${reason} กรุณาอัปโหลดใหม่`);
  res.json({ ok: true });
});

// ---------- Courses (curriculum) ----------
app.get('/api/courses', auth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM courses WHERE active=1 ORDER BY CASE category WHEN 'general' THEN 1 WHEN 'core' THEN 2 ELSE 3 END, id").all());
});
app.post('/api/courses', auth('admin', 'officer'), (req, res) => {
  const { code, name, credits, category, subgroup, department_id } = req.body || {};
  if (!code || !name || !category) return res.status(400).json({ error: 'กรอกรหัสวิชา ชื่อวิชา และหมวดให้ครบ' });
  try {
    db.prepare('INSERT INTO courses (code,name,credits,category,subgroup,department_id) VALUES (?,?,?,?,?,?)')
      .run(code.trim(), name.trim(), credits || 3, category, subgroup || '', department_id || req.session.user.department_id);
    log(req.session.user.id, 'add_course', `${code} ${name}`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'รหัสวิชานี้มีอยู่แล้วในสาขา' }); }
});
app.delete('/api/courses/:id', auth('admin', 'officer'), (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบวิชา' });
  const linked = db.prepare('SELECT COUNT(*) n FROM transfers WHERE course_id=?').get(c.id).n +
    db.prepare('SELECT COUNT(*) n FROM offerings WHERE course_id=?').get(c.id).n;
  if (linked > 0) {
    db.prepare('UPDATE courses SET active=0 WHERE id=?').run(c.id);
    log(req.session.user.id, 'deactivate_course', c.code);
    return res.json({ ok: true, message: 'วิชานี้มีข้อมูลผูกอยู่ จึงปิดใช้งานแทนการลบ' });
  }
  db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
  log(req.session.user.id, 'delete_course', c.code);
  res.json({ ok: true, message: 'ลบวิชาแล้ว' });
});

// ---------- Transfers ----------
app.get('/api/transfers/student/:id', auth(...VIEWERS), (req, res) => {
  res.json(db.prepare(`SELECT t.*, c.code, c.name course_name, r.name recorded_by_name FROM transfers t JOIN courses c ON c.id=t.course_id JOIN users r ON r.id=t.recorded_by WHERE t.student_id=? ORDER BY c.code`).all(req.params.id));
});
app.get('/api/transfers/mine', auth('student'), (req, res) => {
  res.json(db.prepare(`SELECT t.*, c.code, c.name course_name FROM transfers t JOIN courses c ON c.id=t.course_id WHERE t.student_id=? ORDER BY c.code`).all(req.session.user.id));
});
app.post('/api/transfers', auth(...STAFF), (req, res) => {
  const { student_id, course_id, src_institution, src_course, src_credits, src_grade, note } = req.body || {};
  const student = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(student_id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(course_id);
  if (!student || !course) return res.status(400).json({ error: 'ไม่พบนักศึกษาหรือรายวิชา' });
  if (db.prepare('SELECT id FROM transfers WHERE student_id=? AND course_id=?').get(student_id, course_id))
    return res.status(400).json({ error: 'วิชานี้เทียบโอนให้นักศึกษาคนนี้แล้ว' });
  const enrolled = db.prepare(`SELECT e.id FROM enrollments e JOIN offerings o ON o.id=e.offering_id WHERE e.student_id=? AND o.course_id=? AND e.status='enrolled'`).get(student_id, course_id);
  if (enrolled) return res.status(400).json({ error: 'นักศึกษาลงทะเบียนเรียนวิชานี้อยู่ ไม่สามารถเทียบโอนซ้ำได้' });
  db.prepare('INSERT INTO transfers (student_id,course_id,src_institution,src_course,src_credits,src_grade,note,recorded_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(student_id, course_id, src_institution || '', src_course || '', src_credits || null, src_grade || '', note || '', req.session.user.id);
  log(req.session.user.id, 'add_transfer', `${student.user_code} <- ${course.code} (ACC)`);
  notify(student.id, `บันทึกผลเทียบโอนวิชา ${course.code} ${course.name} เป็น ACC แล้ว`);
  res.json({ ok: true });
});
app.delete('/api/transfers/:id', auth('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM transfers WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'ไม่พบรายการ' });
  db.prepare('DELETE FROM transfers WHERE id=?').run(t.id);
  log(req.session.user.id, 'delete_transfer', `transfer#${t.id}`);
  res.json({ ok: true });
});

// ---------- Curriculum view ----------
function curriculum(studentId) {
  const courses = db.prepare("SELECT * FROM courses WHERE active=1 ORDER BY CASE category WHEN 'general' THEN 1 WHEN 'core' THEN 2 ELSE 3 END, id").all();
  const transfers = db.prepare('SELECT course_id FROM transfers WHERE student_id=?').all(studentId).map(t => t.course_id);
  const enrolls = db.prepare(`SELECT o.course_id, s.term, s.year FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN semesters s ON s.id=o.semester_id WHERE e.student_id=? AND e.status='enrolled'`).all(studentId);
  const rows = courses.map(c => {
    let status = '';
    if (transfers.includes(c.id)) status = 'ACC';
    else { const e = enrolls.find(x => x.course_id === c.id); if (e) status = `${e.term}/${e.year}`; }
    return { ...c, status };
  });
  const sum = cat => rows.filter(r => r.category === cat && r.status).reduce((a, r) => a + r.credits, 0);
  return { rows, summary: { general: sum('general'), core: sum('core'), free: sum('free'), acc: rows.filter(r => r.status === 'ACC').reduce((a, r) => a + r.credits, 0), total: sum('general') + sum('core') + sum('free') } };
}
app.get('/api/curriculum/mine', auth('student'), (req, res) => res.json(curriculum(req.session.user.id)));
app.get('/api/curriculum/student/:id', auth(...VIEWERS), (req, res) => res.json(curriculum(req.params.id)));

// ---------- Semesters ----------
app.get('/api/semesters', auth(), (req, res) => res.json(db.prepare('SELECT * FROM semesters ORDER BY year DESC, term DESC').all()));
app.post('/api/semesters', auth(...STAFF), (req, res) => {
  const { term, year } = req.body || {};
  if (!term || !year) return res.status(400).json({ error: 'ระบุเทอมและปีการศึกษา' });
  try {
    db.prepare('UPDATE semesters SET is_current=0').run();
    db.prepare('INSERT INTO semesters (term,year,is_current,registration_open,created_by) VALUES (?,?,1,1,?)').run(term, year, req.session.user.id);
    log(req.session.user.id, 'open_semester', `${term}/${year}`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'เทอม/ปีนี้มีอยู่แล้ว' }); }
});
app.post('/api/semesters/:id/toggle-registration', auth(...STAFF), (req, res) => {
  const s = db.prepare('SELECT * FROM semesters WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบเทอม' });
  db.prepare('UPDATE semesters SET registration_open=? WHERE id=?').run(s.registration_open ? 0 : 1, s.id);
  log(req.session.user.id, 'toggle_registration', `${s.term}/${s.year} -> ${s.registration_open ? 'ปิด' : 'เปิด'}`);
  res.json({ ok: true });
});
function currentSemester() { return db.prepare('SELECT * FROM semesters WHERE is_current=1').get(); }

// ---------- Offerings ----------
app.get('/api/offerings', auth(), (req, res) => {
  const sem = req.query.semester_id ? db.prepare('SELECT * FROM semesters WHERE id=?').get(req.query.semester_id) : currentSemester();
  if (!sem) return res.json({ semester: null, offerings: [] });
  const rows = db.prepare(`SELECT o.*, c.code, c.name course_name, c.credits,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id=o.id AND e.status='enrolled') enrolled_count
    FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.semester_id=? AND o.status IN ('active','pending_add','pending_delete') ORDER BY c.code`).all(sem.id)
    .map(r => ({ ...r, day_name: DAYS[r.day] }));
  res.json({ semester: sem, offerings: rows });
});
app.post('/api/offerings', auth(...STAFF), (req, res) => {
  const { course_id, lecturer_name, day, start_time, end_time, room, capacity } = req.body || {};
  const sem = currentSemester();
  if (!sem) return res.status(400).json({ error: 'ยังไม่มีเทอมปัจจุบัน กรุณาเปิดเทอมก่อน' });
  const course = db.prepare('SELECT * FROM courses WHERE id=? AND active=1').get(course_id);
  if (!course || !lecturer_name || !day || !start_time || !end_time) return res.status(400).json({ error: 'กรอกข้อมูลให้ครบ: วิชา อาจารย์ วัน เวลาเริ่ม-จบ' });
  if (end_time <= start_time) return res.status(400).json({ error: 'เวลาจบต้องหลังเวลาเริ่ม' });
  const isAdmin = req.session.user.role === 'admin';
  const status = isAdmin ? 'active' : 'pending_add';
  db.prepare('INSERT INTO offerings (semester_id,course_id,lecturer_name,day,start_time,end_time,room,capacity,status,requested_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(sem.id, course.id, lecturer_name, day, start_time, end_time, room || '', capacity || 40, status, req.session.user.id);
  log(req.session.user.id, 'request_add_offering', `${course.code} ${sem.term}/${sem.year} (${status})`);
  if (!isAdmin) {
    notifyRole('admin', `${req.session.user.name} ขอเพิ่มวิชา ${course.code} ${course.name} เทอม ${sem.term}/${sem.year} — รอการอนุมัติ`);
    sendEmail('admin', 'คำขอเพิ่มรายวิชา', `${course.code} โดย ${req.session.user.name}`);
  }
  res.json({ ok: true, message: isAdmin ? 'เพิ่มวิชาแล้ว' : 'ส่งคำขอแล้ว รอ Admin อนุมัติ' });
});
app.post('/api/offerings/:id/request-delete', auth(...STAFF), (req, res) => {
  const o = db.prepare('SELECT o.*, c.code, c.name course_name FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=?').get(req.params.id);
  if (!o || o.status !== 'active') return res.status(400).json({ error: 'ลบได้เฉพาะวิชาที่เปิดสอนอยู่' });
  const enrolled = db.prepare("SELECT COUNT(*) n FROM enrollments WHERE offering_id=? AND status='enrolled'").get(o.id).n;
  const isAdmin = req.session.user.role === 'admin';
  if (isAdmin && enrolled === 0) {
    db.prepare("UPDATE offerings SET status='deleted', decided_by=? WHERE id=?").run(req.session.user.id, o.id);
    log(req.session.user.id, 'delete_offering', o.code);
    return res.json({ ok: true, message: 'ลบวิชาแล้ว' });
  }
  db.prepare("UPDATE offerings SET status='pending_delete', requested_by=? WHERE id=?").run(req.session.user.id, o.id);
  log(req.session.user.id, 'request_delete_offering', `${o.code} (มีผู้ลง ${enrolled} คน)`);
  notifyRole('admin', `${req.session.user.name} ขอลบวิชา ${o.code} ${o.course_name}${enrolled ? ` (มีนักศึกษาลง ${enrolled} คน)` : ''} — รอการอนุมัติ`);
  sendEmail('admin', 'คำขอลบรายวิชา', `${o.code} โดย ${req.session.user.name}`);
  res.json({ ok: true, message: 'ส่งคำขอลบแล้ว รอ Admin อนุมัติ' });
});
app.get('/api/approvals', auth('admin'), (req, res) => {
  res.json(db.prepare(`SELECT o.*, c.code, c.name course_name, u.name requester, s.term, s.year,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id=o.id AND e.status='enrolled') enrolled_count
    FROM offerings o JOIN courses c ON c.id=o.course_id JOIN users u ON u.id=o.requested_by JOIN semesters s ON s.id=o.semester_id
    WHERE o.status IN ('pending_add','pending_delete') ORDER BY o.created_at`).all().map(r => ({ ...r, day_name: DAYS[r.day] })));
});
app.post('/api/approvals/:id/decide', auth('admin'), (req, res) => {
  const { approve, reason } = req.body || {};
  const o = db.prepare('SELECT o.*, c.code, c.name course_name FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=?').get(req.params.id);
  if (!o || !['pending_add', 'pending_delete'].includes(o.status)) return res.status(400).json({ error: 'ไม่พบคำขอ' });
  let newStatus, msg;
  if (o.status === 'pending_add') { newStatus = approve ? 'active' : 'rejected'; msg = approve ? 'อนุมัติเพิ่มวิชา' : 'ปฏิเสธเพิ่มวิชา'; }
  else {
    if (approve) {
      db.prepare("UPDATE enrollments SET status='withdrawn', withdrawn_by=?, withdrawn_at=datetime('now','localtime') WHERE offering_id=? AND status='enrolled'").run(req.session.user.id, o.id);
      db.prepare("SELECT student_id FROM enrollments WHERE offering_id=?").all(o.id).forEach(e => notify(e.student_id, `วิชา ${o.code} ${o.course_name} ถูกยกเลิกการเปิดสอน การลงทะเบียนของคุณถูกถอนอัตโนมัติ`));
      newStatus = 'deleted';
    } else newStatus = 'active';
    msg = approve ? 'อนุมัติลบวิชา' : 'ปฏิเสธลบวิชา';
  }
  db.prepare('UPDATE offerings SET status=?, decided_by=?, decide_reason=? WHERE id=?').run(newStatus, req.session.user.id, reason || '', o.id);
  log(req.session.user.id, 'decide_offering', `${o.code}: ${msg}`);
  notify(o.requested_by, `${msg} ${o.code} ${o.course_name}${reason ? ` เหตุผล: ${reason}` : ''}`);
  res.json({ ok: true });
});

// ---------- Enrollment ----------
function overlap(a, b) { return a.day === b.day && a.start_time < b.end_time && b.start_time < a.end_time; }
app.post('/api/enroll', auth('student'), (req, res) => {
  const { offering_ids } = req.body || {};
  if (!Array.isArray(offering_ids) || !offering_ids.length) return res.status(400).json({ error: 'กรุณาติ๊กเลือกวิชาอย่างน้อย 1 วิชา' });
  const sem = currentSemester();
  if (!sem || !sem.registration_open) return res.status(400).json({ error: 'ขณะนี้ปิดการลงทะเบียน' });
  const sid = req.session.user.id;
  const chosen = offering_ids.map(id => db.prepare(`SELECT o.*, c.code, c.name course_name FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=? AND o.status='active' AND o.semester_id=?`).get(id, sem.id));
  if (chosen.some(c => !c)) return res.status(400).json({ error: 'มีวิชาที่เลือกไม่พร้อมให้ลงทะเบียน กรุณารีเฟรชหน้า' });
  const mine = db.prepare(`SELECT o.*, c.code, c.name course_name FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id WHERE e.student_id=? AND e.status='enrolled' AND o.semester_id=?`).all(sid, sem.id);
  const transfers = db.prepare('SELECT course_id FROM transfers WHERE student_id=?').all(sid).map(t => t.course_id);
  const errors = [];
  for (const c of chosen) {
    if (transfers.includes(c.course_id)) { errors.push(`${c.code} ${c.course_name}: เทียบโอน (ACC) ไปแล้ว ไม่ต้องลงเรียน`); continue; }
    if (mine.some(m => m.course_id === c.course_id) || db.prepare(`SELECT e.id FROM enrollments e JOIN offerings o ON o.id=e.offering_id WHERE e.student_id=? AND o.course_id=? AND e.status='enrolled'`).get(sid, c.course_id))
      { errors.push(`${c.code} ${c.course_name}: ลงทะเบียนวิชานี้ไปแล้ว`); continue; }
    const cnt = db.prepare("SELECT COUNT(*) n FROM enrollments WHERE offering_id=? AND status='enrolled'").get(c.id).n;
    if (cnt >= c.capacity) { errors.push(`${c.code} ${c.course_name}: ที่นั่งเต็มแล้ว`); continue; }
    const clash = [...mine, ...chosen.filter(x => x.id !== c.id && !errors.some(er => er.startsWith(x.code)))].find(m => m.id !== c.id && overlap(m, c));
    if (clash) { errors.push(`${c.code} ${c.course_name}: เวลาเรียนชนกับ ${clash.code} ${clash.course_name} (${DAYS[clash.day]} ${clash.start_time}–${clash.end_time})`); continue; }
  }
  if (errors.length) return res.status(400).json({ error: 'ลงทะเบียนไม่สำเร็จ:\n' + errors.join('\n') });
  const ins = db.prepare('INSERT INTO enrollments (student_id,offering_id) VALUES (?,?)');
  const tx = db.transaction(() => chosen.forEach(c => ins.run(sid, c.id)));
  tx();
  chosen.forEach(c => log(sid, 'enroll', `${c.code} ${sem.term}/${sem.year}`));
  res.json({ ok: true, message: `ลงทะเบียนสำเร็จ ${chosen.length} วิชา` });
});
app.get('/api/enrollments/mine', auth('student'), (req, res) => {
  res.json(db.prepare(`SELECT e.id, e.status, o.*, c.code, c.name course_name, c.credits, s.term, s.year FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id JOIN semesters s ON s.id=o.semester_id WHERE e.student_id=? AND e.status='enrolled' ORDER BY s.year DESC, s.term DESC, c.code`).all(req.session.user.id).map(r => ({ ...r, day_name: DAYS[r.day] })));
});
app.get('/api/enrollments/student/:id', auth(...VIEWERS), (req, res) => {
  res.json(db.prepare(`SELECT e.id, e.status, o.day, o.start_time, o.end_time, o.room, o.lecturer_name, c.code, c.name course_name, c.credits, s.term, s.year FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id JOIN semesters s ON s.id=o.semester_id WHERE e.student_id=? AND e.status='enrolled' ORDER BY s.year DESC, s.term DESC, c.code`).all(req.params.id).map(r => ({ ...r, day_name: DAYS[r.day] })));
});
app.post('/api/enrollments/:id/withdraw', auth(...STAFF), (req, res) => {
  const e = db.prepare(`SELECT e.*, c.code, c.name course_name FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id WHERE e.id=?`).get(req.params.id);
  if (!e || e.status !== 'enrolled') return res.status(404).json({ error: 'ไม่พบรายการลงทะเบียน' });
  db.prepare("UPDATE enrollments SET status='withdrawn', withdrawn_by=?, withdrawn_at=datetime('now','localtime') WHERE id=?").run(req.session.user.id, e.id);
  log(req.session.user.id, 'withdraw', `enrollment#${e.id} (${e.code})`);
  notify(e.student_id, `คุณถูกถอนรายวิชา ${e.code} ${e.course_name} โดย ${req.session.user.name}`);
  res.json({ ok: true });
});

// ---------- Timetable ----------
function timetable(studentId, semesterId) {
  const sem = semesterId ? db.prepare('SELECT * FROM semesters WHERE id=?').get(semesterId) : currentSemester();
  if (!sem) return { semester: null, items: [] };
  const items = db.prepare(`SELECT o.day, o.start_time, o.end_time, o.room, o.lecturer_name, c.code, c.name course_name FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id WHERE e.student_id=? AND e.status='enrolled' AND o.semester_id=? ORDER BY o.day, o.start_time`).all(studentId, sem.id)
    .map(r => ({ ...r, day_name: DAYS[r.day] }));
  return { semester: sem, items };
}
app.get('/api/timetable/mine', auth('student'), (req, res) => res.json(timetable(req.session.user.id, req.query.semester_id)));
app.get('/api/timetable/student/:id', auth(...VIEWERS), (req, res) => res.json(timetable(req.params.id, req.query.semester_id)));
app.get('/api/timetable/teaching', auth('lecturer'), (req, res) => {
  const sem = currentSemester();
  if (!sem) return res.json({ semester: null, items: [] });
  const items = db.prepare(`SELECT o.day, o.start_time, o.end_time, o.room, o.lecturer_name, c.code, c.name course_name FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.semester_id=? AND o.status='active' AND o.lecturer_name LIKE ? ORDER BY o.day, o.start_time`).all(sem.id, `%${req.session.user.name.split(' ')[0]}%`)
    .map(r => ({ ...r, day_name: DAYS[r.day] }));
  res.json({ semester: sem, items });
});

// ---------- Notifications / dashboard / audit ----------
app.get('/api/notifications', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.session.user.id));
});
app.post('/api/notifications/read-all', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.session.user.id);
  res.json({ ok: true });
});
app.get('/api/dashboard', auth(), (req, res) => {
  const u = req.session.user;
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get(u.id).n;
  const sem = currentSemester();
  const out = { unread, semester: sem };
  if (u.role === 'student') {
    const docs = docList(u.id);
    out.docs_missing = docs.filter(d => !d.doc | (d.doc && d.doc.status === 'rejected')).length;
    out.docs_missing = docs.filter(d => !d.doc || d.doc.status === 'rejected').length;
    out.docs_pending = docs.filter(d => d.doc && d.doc.status === 'pending').length;
    out.enrolled = sem ? db.prepare(`SELECT COUNT(*) n FROM enrollments e JOIN offerings o ON o.id=e.offering_id WHERE e.student_id=? AND e.status='enrolled' AND o.semester_id=?`).get(u.id, sem.id).n : 0;
    out.registration_open = !!(sem && sem.registration_open);
  }
  if (['admin', 'officer'].includes(u.role)) {
    out.docs_to_review = db.prepare("SELECT COUNT(*) n FROM documents WHERE status='pending'").get().n;
  }
  if (u.role === 'admin') {
    out.approvals = db.prepare("SELECT COUNT(*) n FROM offerings WHERE status IN ('pending_add','pending_delete')").get().n;
  }
  res.json(out);
});
app.get('/api/audit', auth('admin'), (req, res) => {
  res.json(db.prepare(`SELECT a.*, u.user_code, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all());
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
});

app.listen(PORT, () => console.log(`ระบบคณะวิศวกรรมศาสตร์ฯ พร้อมใช้งานที่ http://localhost:${PORT}`));
