let USER = null;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url, opts = {}) {
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), isErr ? 6000 : 3000);
}
function openModal(html) { $('modal').innerHTML = html; $('modal-wrap').classList.remove('hidden'); }
function closeModal() { $('modal-wrap').classList.add('hidden'); }

// ---------- Auth ----------
async function doLogin() {
  $('login-error').textContent = '';
  try {
    const d = await api('/api/login', { method: 'POST', body: { user_code: $('login-code').value, password: $('login-pass').value } });
    USER = d.user;
    enterApp(d.must_change_password);
  } catch (e) { $('login-error').textContent = e.message; }
}
async function doLogout() { await api('/api/logout', { method: 'POST' }); location.reload(); }

function forcePasswordModal() {
  openModal(`<h2>ตั้งรหัสผ่านใหม่ก่อนใช้งาน</h2>
    <p class="muted">เพื่อความปลอดภัย กรุณาเปลี่ยนรหัสผ่านจากรหัสเริ่มต้น</p>
    <div class="row"><label>รหัสผ่านเดิม</label><input type="password" id="cp-old"></div>
    <div class="row"><label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label><input type="password" id="cp-new"></div>
    <div class="modal-actions"><button class="btn-primary" onclick="submitChangePass()">บันทึกรหัสผ่านใหม่</button></div>`);
}
async function submitChangePass() {
  try {
    await api('/api/change-password', { method: 'POST', body: { old_password: $('cp-old').value, new_password: $('cp-new').value } });
    closeModal(); toast('เปลี่ยนรหัสผ่านเรียบร้อย');
  } catch (e) { toast(e.message, true); }
}

// ---------- Shell ----------
const MENUS = {
  student: [['home','หน้าแรก'],['docs','เอกสารของฉัน'],['curriculum','หลักสูตรของฉัน'],['register','ลงทะเบียน'],['timetable','ตารางสอน']],
  admin: [['home','หน้าแรก'],['approvals','คำขออนุมัติ'],['review','ตรวจเอกสาร'],['students','นักศึกษา'],['offerings','รายวิชาเปิดสอน'],['courses','หลักสูตร'],['users','ผู้ใช้'],['semesters','เทอม'],['audit','ประวัติระบบ']],
  officer: [['home','หน้าแรก'],['review','ตรวจเอกสาร'],['students','นักศึกษา'],['offerings','รายวิชาเปิดสอน'],['courses','หลักสูตร'],['users','ผู้ใช้'],['semesters','เทอม']],
  lecturer: [['home','หน้าแรก'],['students','นักศึกษา'],['offerings','รายวิชาเปิดสอน'],['teaching','ตารางสอนของฉัน'],['semesters','เทอม']],
  counselor: [['home','หน้าแรก'],['students','นักศึกษา']]
};
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', officer: 'เจ้าหน้าที่', lecturer: 'อาจารย์', counselor: 'อาจารย์แนะแนว', student: 'นักศึกษา' };

function enterApp(mustChange) {
  $('login-page').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-info').textContent = `${USER.name} (${ROLE_TH[USER.role]})`;
  $('nav').innerHTML = MENUS[USER.role].map(([k, label]) => `<button id="nav-${k}" onclick="go('${k}')">${label}</button>`).join('');
  refreshNotifBadge();
  setInterval(refreshNotifBadge, 30000);
  go('home');
  if (mustChange) forcePasswordModal();
}
function go(view) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const nb = $('nav-' + view); if (nb) nb.classList.add('active');
  $('notif-panel').classList.add('hidden');
  VIEWS[view]();
}

// ---------- Notifications ----------
async function refreshNotifBadge() {
  try {
    const d = await api('/api/dashboard');
    const b = $('notif-badge');
    if (d.unread > 0) { b.textContent = d.unread; b.classList.remove('hidden'); } else b.classList.add('hidden');
  } catch (e) {}
}
async function toggleNotif() {
  const p = $('notif-panel');
  if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
  const items = await api('/api/notifications');
  p.innerHTML = items.length
    ? items.map(n => `<div class="notif-item ${n.is_read ? '' : 'unread'}">${esc(n.message)}<div class="muted">${esc(n.created_at)}</div></div>`).join('')
    : '<div class="notif-item muted">ยังไม่มีการแจ้งเตือน</div>';
  p.classList.remove('hidden');
  await api('/api/notifications/read-all', { method: 'POST' });
  refreshNotifBadge();
}

// ---------- Views ----------
const VIEWS = {};

VIEWS.home = async () => {
  const d = await api('/api/dashboard');
  let h = `<h2 style="margin-bottom:14px">สวัสดี, ${esc(USER.name)}</h2>`;
  if (d.semester) h += `<p class="muted" style="margin-bottom:14px">ภาคเรียนปัจจุบัน ${d.semester.term}/${d.semester.year} · ${d.semester.registration_open ? 'เปิดลงทะเบียน' : 'ปิดลงทะเบียน'}</p>`;
  if (USER.role === 'student') {
    if (d.docs_missing > 0) h += bigAction('warn', d.docs_missing, 'เอกสารที่ยังไม่ส่งหรือถูกตีกลับ', 'กดเพื่ออัปโหลดเอกสาร', "go('docs')");
    if (d.docs_pending > 0) h += bigAction('', d.docs_pending, 'เอกสารรอเจ้าหน้าที่ตรวจ', 'ดูสถานะเอกสาร', "go('docs')");
    if (d.registration_open) h += bigAction(d.enrolled ? 'ok' : 'warn', d.enrolled, 'วิชาที่ลงทะเบียนเทอมนี้', d.enrolled ? 'ดู/เพิ่มวิชา' : 'ยังไม่ได้ลงทะเบียน — กดเพื่อลงทะเบียน', "go('register')");
    if (!d.docs_missing && !d.docs_pending) h += bigAction('ok', '✓', 'เอกสารครบถ้วนแล้ว', 'ดูเอกสารของฉัน', "go('docs')");
  } else {
    if (d.docs_to_review !== undefined) h += bigAction(d.docs_to_review ? 'warn' : 'ok', d.docs_to_review, 'เอกสารรอตรวจ', 'กดเพื่อตรวจเอกสาร', "go('review')");
    if (d.approvals !== undefined) h += bigAction(d.approvals ? 'warn' : 'ok', d.approvals, 'คำขอเพิ่ม/ลบวิชารออนุมัติ', 'กดเพื่อพิจารณา', "go('approvals')");
    if (['lecturer','counselor'].includes(USER.role)) h += bigAction('', '🔍', 'ค้นหานักศึกษา', 'ดูข้อมูล เอกสาร เทียบโอน หลักสูตร', "go('students')");
  }
  $('main').innerHTML = h;
};
const bigAction = (cls, num, ttl, sub, onclick) =>
  `<div class="big-action ${cls}" onclick="${onclick}"><div class="num">${num}</div><div><div class="ttl">${ttl}</div><div class="muted">${sub}</div></div></div>`;

// ----- Student: documents wizard -----
VIEWS.docs = async () => {
  const list = await api('/api/documents/mine');
  const done = list.filter(d => d.doc && d.doc.status !== 'rejected').length;
  let h = `<div class="card"><h2>เอกสารของฉัน (${done}/6)</h2>
    <div class="step-bar">${list.map(d => `<div class="step ${d.doc ? (d.doc.status === 'rejected' ? '' : 'done') : ''}"></div>`).join('')}</div>
    <table><thead><tr><th>เอกสาร</th><th>สถานะ</th><th></th></tr></thead><tbody>`;
  for (const d of list) {
    let pill = '<span class="pill pill-gray">ยังไม่ส่ง</span>', extra = '';
    if (d.doc) {
      if (d.doc.status === 'pending') pill = '<span class="pill pill-amber">รอตรวจ</span>';
      if (d.doc.status === 'approved') pill = '<span class="pill pill-green">ผ่าน</span>';
      if (d.doc.status === 'rejected') { pill = '<span class="pill pill-red">ตีกลับ</span>'; extra = `<div class="muted">เหตุผล: ${esc(d.doc.reason)}</div>`; }
    }
    const canUp = !d.doc || d.doc.status === 'rejected' || d.doc.status === 'pending';
    h += `<tr><td>${d.label}${extra}</td><td>${pill}</td><td style="text-align:right">
      ${d.doc ? `<button class="btn-sm" onclick="window.open('/api/documents/${d.doc.id}/file')">ดูไฟล์</button>` : ''}
      ${canUp ? `<button class="btn-sm btn-primary" onclick="pickFile('${d.doc_type}','${d.label}')">${d.doc ? 'ส่งใหม่' : 'อัปโหลด'}</button>` : ''}
    </td></tr>`;
  }
  h += '</tbody></table><p class="muted" style="margin-top:10px">รับไฟล์ PDF, JPG, PNG ขนาดไม่เกิน 10MB</p></div>';
  $('main').innerHTML = h;
};
function pickFile(docType, label) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.jpg,.jpeg,.png';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    const fd = new FormData();
    fd.append('doc_type', docType); fd.append('file', inp.files[0]);
    try { await api('/api/documents/upload', { method: 'POST', body: fd }); toast(`ส่ง${label}เรียบร้อย รอเจ้าหน้าที่ตรวจ`); VIEWS.docs(); }
    catch (e) { toast(e.message, true); }
  };
  inp.click();
}

// ----- Curriculum table (shared) -----
function curriculumTable(cur) {
  const cats = [['general', 'หมวดวิชาศึกษาทั่วไป'], ['core', 'หมวดวิชาแกน'], ['free', 'หมวดวิชาเสรี']];
  let h = '<div class="table-scroll"><table><thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th style="text-align:center">หน่วยกิต</th><th style="text-align:center">สถานะ</th></tr></thead><tbody>';
  for (const [cat, label] of cats) {
    h += `<tr class="cat-row"><td colspan="4">${label}</td></tr>`;
    for (const c of cur.rows.filter(r => r.category === cat)) {
      const st = c.status === 'ACC' ? '<span class="pill pill-green">ACC</span>' : (c.status ? `<span class="pill pill-blue">${c.status}</span>` : '');
      h += `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td style="text-align:center">${c.credits}</td><td style="text-align:center">${st}</td></tr>`;
    }
  }
  h += `</tbody></table></div>
  <div class="summary-row"><span>เทียบโอน (ACC): <b>${cur.summary.acc}</b> น.ก.</span><span>ศึกษาทั่วไป: <b>${cur.summary.general}</b></span><span>วิชาแกน: <b>${cur.summary.core}</b></span><span>วิชาเสรี: <b>${cur.summary.free}</b></span><span>รวมสะสม: <b>${cur.summary.total}</b> น.ก.</span></div>`;
  return h;
}
VIEWS.curriculum = async () => {
  const cur = await api('/api/curriculum/mine');
  $('main').innerHTML = `<div class="card"><h2>หลักสูตรของฉัน</h2><p class="muted" style="margin-bottom:10px">ACC = เทียบโอนผ่าน · ตัวเลข = เทอม/ปีที่ลงทะเบียน · ว่าง = ยังไม่ลง</p>${curriculumTable(cur)}</div>`;
};

// ----- Registration -----
VIEWS.register = async () => {
  const [d, mine] = await Promise.all([api('/api/offerings'), api('/api/enrollments/mine')]);
  if (!d.semester) { $('main').innerHTML = '<div class="card"><h2>ลงทะเบียน</h2><p class="muted">ยังไม่เปิดภาคเรียน</p></div>'; return; }
  const myCourseIds = mine.filter(e => e.semester_id === d.semester.id).map(e => e.course_id);
  const active = d.offerings.filter(o => o.status === 'active');
  let h = `<div class="card"><h2>ลงทะเบียนเรียน ภาคเรียน ${d.semester.term}/${d.semester.year}
    ${d.semester.registration_open ? '<span class="pill pill-green">เปิดลงทะเบียน</span>' : '<span class="pill pill-red">ปิดลงทะเบียน</span>'}</h2>`;
  if (mine.length) {
    h += '<h3>วิชาที่ลงทะเบียนแล้ว</h3><div class="table-scroll"><table><tbody>' + mine.map(e =>
      `<tr><td>${esc(e.code)}</td><td>${esc(e.course_name)}</td><td>${esc(e.day_name)} ${e.start_time}–${e.end_time}</td><td>${esc(e.lecturer_name)}</td><td>${e.term}/${e.year}</td></tr>`).join('') + '</tbody></table></div>';
  }
  h += `<h3>รายวิชาที่เปิดสอน — ติ๊กเลือกแล้วกดยืนยันด้านล่าง</h3>
    <div class="table-scroll"><table><thead><tr><th style="width:40px;text-align:center">เลือก</th><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>อาจารย์ผู้สอน</th><th>วัน-เวลา</th><th>ห้อง</th><th style="text-align:center">ที่นั่ง</th></tr></thead><tbody>`;
  for (const o of active) {
    const already = myCourseIds.includes(o.course_id);
    const full = o.enrolled_count >= o.capacity;
    h += `<tr><td style="text-align:center">${already ? '<span class="pill pill-blue">ลงแล้ว</span>' : (full ? '<span class="pill pill-red">เต็ม</span>' : `<input type="checkbox" class="enroll-cb" value="${o.id}" style="width:18px;height:18px">`)}</td>
      <td>${esc(o.code)}</td><td>${esc(o.course_name)}</td><td>${esc(o.lecturer_name)}</td><td>${esc(o.day_name)} ${o.start_time}–${o.end_time}</td><td>${esc(o.room)}</td><td style="text-align:center">${o.enrolled_count}/${o.capacity}</td></tr>`;
  }
  h += `</tbody></table></div>
    <div class="actions-bar"><button onclick="clearEnrollChecks()">ยกเลิก</button>
    <button class="btn-primary" onclick="submitEnroll()" ${d.semester.registration_open ? '' : 'disabled'}>ยืนยันการลงทะเบียน</button></div></div>`;
  $('main').innerHTML = h;
};
function clearEnrollChecks() { document.querySelectorAll('.enroll-cb').forEach(c => c.checked = false); toast('ล้างการเลือกแล้ว'); }
async function submitEnroll() {
  const ids = [...document.querySelectorAll('.enroll-cb:checked')].map(c => +c.value);
  if (!ids.length) return toast('กรุณาติ๊กเลือกวิชาอย่างน้อย 1 วิชา', true);
  try { const r = await api('/api/enroll', { method: 'POST', body: { offering_ids: ids } }); toast(r.message); VIEWS.register(); }
  catch (e) { toast(e.message, true); }
}

// ----- Timetable -----
function timetableGrid(data) {
  if (!data.semester) return '<p class="muted">ยังไม่เปิดภาคเรียน</p>';
  const slots = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
  const days = [[1,'จันทร์'],[2,'อังคาร'],[3,'พุธ'],[4,'พฤหัสบดี'],[5,'ศุกร์'],[6,'เสาร์'],[7,'อาทิตย์']];
  let h = `<p class="muted" style="margin-bottom:8px">ภาคเรียน ${data.semester.term}/${data.semester.year}</p>
    <div class="table-scroll"><table class="tt-grid"><thead><tr><th style="width:70px">วัน</th>${slots.map(s => `<th style="font-size:11px">${s}</th>`).join('')}</tr></thead><tbody>`;
  for (const [dnum, dname] of days) {
    h += `<tr><td style="font-weight:600;font-size:13px">${dname}</td>`;
    let skip = 0;
    for (let i = 0; i < slots.length; i++) {
      if (skip > 0) { skip--; continue; }
      const item = data.items.find(x => x.day === dnum && x.start_time.slice(0,5) === slots[i]);
      if (item) {
        const span = Math.max(1, Math.round((parseInt(item.end_time) - parseInt(item.start_time))));
        skip = span - 1;
        h += `<td colspan="${span}"><div class="tt-item"><b>${esc(item.code)}</b> ${esc(item.course_name)}<br>${esc(item.lecturer_name)} · ${esc(item.room || '-')}</div></td>`;
      } else h += '<td></td>';
    }
    h += '</tr>';
  }
  return h + '</tbody></table></div>';
}
VIEWS.timetable = async () => {
  const data = await api('/api/timetable/mine');
  $('main').innerHTML = `<div class="card"><h2>ตารางสอนของฉัน</h2>${timetableGrid(data)}
    <div class="actions-bar"><button onclick="window.print()">พิมพ์ตารางสอน</button></div></div>`;
};
VIEWS.teaching = async () => {
  const data = await api('/api/timetable/teaching');
  $('main').innerHTML = `<div class="card"><h2>ตารางสอนของฉัน (วิชาที่สอน)</h2>${timetableGrid(data)}
    <div class="actions-bar"><button onclick="window.print()">พิมพ์</button></div></div>`;
};

// ----- Staff: review documents -----
VIEWS.review = async () => {
  const list = await api('/api/documents/pending');
  let h = `<div class="card"><h2>เอกสารรอตรวจ (${list.length})</h2>`;
  if (!list.length) h += '<p class="muted">ไม่มีเอกสารรอตรวจ</p>';
  else {
    h += '<div class="table-scroll"><table><thead><tr><th>นักศึกษา</th><th>เอกสาร</th><th>ส่งเมื่อ</th><th></th></tr></thead><tbody>';
    for (const d of list) h += `<tr><td>${esc(d.user_code)}<br><span class="muted">${esc(d.student_name)}</span></td><td>${esc(d.label)}</td><td class="muted">${esc(d.uploaded_at)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn-sm" onclick="window.open('/api/documents/${d.id}/file')">ดูไฟล์</button>
      <button class="btn-sm btn-primary" onclick="reviewDoc(${d.id}, true)">ผ่าน</button>
      <button class="btn-sm btn-danger" onclick="reviewDoc(${d.id}, false)">ตีกลับ</button></td></tr>`;
    h += '</tbody></table></div>';
  }
  $('main').innerHTML = h + '</div>';
};
async function reviewDoc(id, approve) {
  let reason = '';
  if (!approve) { reason = prompt('ระบุเหตุผลที่ตีกลับ (นักศึกษาจะเห็นข้อความนี้):'); if (!reason) return; }
  try { await api(`/api/documents/${id}/review`, { method: 'POST', body: { status: approve ? 'approved' : 'rejected', reason } }); toast(approve ? 'อนุมัติเอกสารแล้ว' : 'ตีกลับเอกสารแล้ว'); VIEWS.review(); }
  catch (e) { toast(e.message, true); }
}

// ----- Staff: students search + profile -----
VIEWS.students = () => {
  $('main').innerHTML = `<div class="card"><h2>ค้นหานักศึกษา</h2>
    <input class="search-box" id="stu-q" placeholder="พิมพ์ชื่อหรือรหัสนักศึกษา..." oninput="searchStudents()">
    <div id="stu-results"></div></div><div id="stu-profile"></div>`;
  searchStudents();
};
let _searchTimer;
function searchStudents() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(async () => {
    const list = await api('/api/students/search?q=' + encodeURIComponent($('stu-q').value));
    $('stu-results').innerHTML = list.map(s => `<div class="result-item" onclick="openStudent(${s.id}, '${esc(s.user_code)}', '${esc(s.name)}')"><b>${esc(s.user_code)}</b> — ${esc(s.name)}</div>`).join('') || '<p class="muted" style="margin-top:8px">ไม่พบนักศึกษา</p>';
  }, 250);
}
let CUR_STUDENT = null;
async function openStudent(id, code, name) {
  CUR_STUDENT = { id, code, name };
  const canEdit = ['admin', 'officer', 'lecturer'].includes(USER.role);
  $('stu-profile').innerHTML = `<div class="card"><h2>${esc(code)} — ${esc(name)}</h2>
    <div class="tabs">
      <button id="ptab-docs" class="active" onclick="stuTab('docs')">เอกสาร</button>
      <button id="ptab-transfer" onclick="stuTab('transfer')">เทียบโอน</button>
      <button id="ptab-cur" onclick="stuTab('cur')">หลักสูตร</button>
      <button id="ptab-enroll" onclick="stuTab('enroll')">การลงทะเบียน</button>
      <button id="ptab-tt" onclick="stuTab('tt')">ตารางสอน</button>
    </div><div id="ptab-body"></div></div>`;
  stuTab('docs');
}
async function stuTab(tab) {
  document.querySelectorAll('[id^=ptab-]').forEach(b => b.classList && b.classList.remove('active'));
  $('ptab-' + tab).classList.add('active');
  const body = $('ptab-body');
  const sid = CUR_STUDENT.id;
  const canEdit = ['admin', 'officer', 'lecturer'].includes(USER.role);
  if (tab === 'docs') {
    const list = await api('/api/documents/student/' + sid);
    body.innerHTML = '<table><tbody>' + list.map(d => {
      let pill = '<span class="pill pill-gray">ยังไม่ส่ง</span>';
      if (d.doc) pill = { pending: '<span class="pill pill-amber">รอตรวจ</span>', approved: '<span class="pill pill-green">ผ่าน</span>', rejected: '<span class="pill pill-red">ตีกลับ</span>' }[d.doc.status];
      return `<tr><td>${d.label}</td><td>${pill}</td><td style="text-align:right">${d.doc ? `<button class="btn-sm" onclick="window.open('/api/documents/${d.doc.id}/file')">ดูไฟล์</button>` : ''}</td></tr>`;
    }).join('') + '</tbody></table>';
  }
  if (tab === 'transfer') {
    const list = await api('/api/transfers/student/' + sid);
    let h = list.length ? '<div class="table-scroll"><table><thead><tr><th>วิชาปลายทาง</th><th>วิชาต้นทาง</th><th>สถาบันเดิม</th><th>เกรด</th><th style="text-align:center">ผล</th></tr></thead><tbody>' +
      list.map(t => `<tr><td>${esc(t.code)} ${esc(t.course_name)}</td><td>${esc(t.src_course)}</td><td>${esc(t.src_institution)}</td><td>${esc(t.src_grade)}</td><td style="text-align:center"><span class="pill pill-green">ACC</span></td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="muted">ยังไม่มีรายการเทียบโอน</p>';
    if (canEdit) h += `<div class="actions-bar"><button class="btn-primary" onclick="transferModal()">+ บันทึกเทียบโอน</button></div>`;
    body.innerHTML = h;
  }
  if (tab === 'cur') body.innerHTML = curriculumTable(await api('/api/curriculum/student/' + sid));
  if (tab === 'enroll') {
    const list = await api('/api/enrollments/student/' + sid);
    body.innerHTML = list.length ? '<div class="table-scroll"><table><thead><tr><th>วิชา</th><th>เทอม</th><th>วัน-เวลา</th><th></th></tr></thead><tbody>' +
      list.map(e => `<tr><td>${esc(e.code)} ${esc(e.course_name)}</td><td>${e.term}/${e.year}</td><td>${esc(e.day_name)} ${e.start_time}–${e.end_time}</td>
        <td style="text-align:right">${canEdit ? `<button class="btn-sm btn-danger" onclick="withdrawEnroll(${e.id})">ถอนวิชา</button>` : ''}</td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="muted">ยังไม่มีการลงทะเบียน</p>';
  }
  if (tab === 'tt') body.innerHTML = timetableGrid(await api('/api/timetable/student/' + sid));
}
async function withdrawEnroll(id) {
  if (!confirm('ยืนยันการถอนรายวิชานี้?')) return;
  try { await api(`/api/enrollments/${id}/withdraw`, { method: 'POST' }); toast('ถอนรายวิชาแล้ว'); stuTab('enroll'); } catch (e) { toast(e.message, true); }
}
async function transferModal() {
  const courses = await api('/api/courses');
  openModal(`<h2>บันทึกเทียบโอน — ${esc(CUR_STUDENT.code)} ${esc(CUR_STUDENT.name)}</h2>
    <div class="row"><label>วิชาปลายทางในหลักสูตร</label><select id="tf-course">${courses.map(c => `<option value="${c.id}">${esc(c.code)} ${esc(c.name)} (${c.credits} น.ก.)</option>`).join('')}</select></div>
    <div class="row"><label>สถาบันเดิม</label><input id="tf-inst"></div>
    <div class="row"><label>วิชาต้นทาง (รหัส + ชื่อ)</label><input id="tf-src"></div>
    <div class="row"><label>หน่วยกิตต้นทาง</label><input id="tf-cr" type="number" step="0.5"></div>
    <div class="row"><label>เกรดต้นทาง</label><input id="tf-grade" placeholder="เช่น 3.5, A, S"></div>
    <div class="row"><label>หมายเหตุ</label><input id="tf-note"></div>
    <p class="muted">เกณฑ์: เกรด ≥ 2.00 และหน่วยกิตต้นทาง ≥ ปลายทาง ผลบันทึกเป็น ACC</p>
    <div class="modal-actions"><button onclick="closeModal()">ยกเลิก</button><button class="btn-primary" onclick="submitTransfer()">บันทึก ACC</button></div>`);
}
async function submitTransfer() {
  try {
    await api('/api/transfers', { method: 'POST', body: {
      student_id: CUR_STUDENT.id, course_id: +$('tf-course').value, src_institution: $('tf-inst').value,
      src_course: $('tf-src').value, src_credits: +$('tf-cr').value || null, src_grade: $('tf-grade').value, note: $('tf-note').value } });
    closeModal(); toast('บันทึกเทียบโอน (ACC) เรียบร้อย'); stuTab('transfer');
  } catch (e) { toast(e.message, true); }
}

// ----- Offerings management -----
VIEWS.offerings = async () => {
  const d = await api('/api/offerings');
  if (!d.semester) { $('main').innerHTML = `<div class="card"><h2>รายวิชาเปิดสอน</h2><p class="muted">ยังไม่เปิดภาคเรียน — ไปที่เมนู "เทอม" เพื่อเปิดเทอมใหม่</p></div>`; return; }
  const stPill = s => ({ active: '<span class="pill pill-green">เปิดสอน</span>', pending_add: '<span class="pill pill-amber">รออนุมัติเพิ่ม</span>', pending_delete: '<span class="pill pill-amber">รออนุมัติลบ</span>' }[s] || s);
  let h = `<div class="card"><h2>รายวิชาเปิดสอน ภาคเรียน ${d.semester.term}/${d.semester.year}</h2>
    <div class="table-scroll"><table><thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>อาจารย์</th><th>วัน-เวลา</th><th>ห้อง</th><th style="text-align:center">ลง/รับ</th><th>สถานะ</th><th></th></tr></thead><tbody>`;
  for (const o of d.offerings) {
    h += `<tr><td>${esc(o.code)}</td><td>${esc(o.course_name)}</td><td>${esc(o.lecturer_name)}</td><td>${esc(o.day_name)} ${o.start_time}–${o.end_time}</td><td>${esc(o.room)}</td>
      <td style="text-align:center">${o.enrolled_count}/${o.capacity}</td><td>${stPill(o.status)}</td>
      <td style="text-align:right">${o.status === 'active' ? `<button class="btn-sm btn-danger" onclick="requestDeleteOffering(${o.id}, '${esc(o.code)}')">ลบ</button>` : ''}</td></tr>`;
  }
  h += `</tbody></table></div>
    <div class="actions-bar"><button class="btn-primary" onclick="offeringModal()">+ เพิ่มรายวิชาที่เปิดสอน</button></div>
    <p class="muted">${USER.role === 'admin' ? 'คุณเป็น Admin: เพิ่ม/ลบมีผลทันที (ยกเว้นลบวิชาที่มีนักศึกษาลง ต้องยืนยันผ่านหน้าคำขอ)' : 'การเพิ่ม/ลบของคุณจะส่งคำขอไปยัง Admin เพื่ออนุมัติก่อนมีผลจริง'}</p></div>`;
  $('main').innerHTML = h;
};
async function offeringModal() {
  const courses = await api('/api/courses');
  openModal(`<h2>เพิ่มรายวิชาที่เปิดสอน</h2>
    <div class="row"><label>วิชา</label><select id="of-course">${courses.map(c => `<option value="${c.id}">${esc(c.code)} ${esc(c.name)}</option>`).join('')}</select></div>
    <div class="row"><label>อาจารย์ผู้สอน</label><input id="of-lect"></div>
    <div class="row"><label>วันที่สอน</label><select id="of-day"><option value="1">จันทร์</option><option value="2">อังคาร</option><option value="3">พุธ</option><option value="4">พฤหัสบดี</option><option value="5">ศุกร์</option><option value="6">เสาร์</option><option value="7">อาทิตย์</option></select></div>
    <div class="row" style="display:flex;gap:8px"><div style="flex:1"><label>เวลาเริ่ม</label><input id="of-start" type="time" value="09:00" style="width:100%"></div><div style="flex:1"><label>เวลาจบ</label><input id="of-end" type="time" value="12:00" style="width:100%"></div></div>
    <div class="row" style="display:flex;gap:8px"><div style="flex:1"><label>ห้อง</label><input id="of-room" style="width:100%"></div><div style="flex:1"><label>จำนวนรับ</label><input id="of-cap" type="number" value="40" style="width:100%"></div></div>
    <div class="modal-actions"><button onclick="closeModal()">ยกเลิก</button><button class="btn-primary" onclick="submitOffering()">${USER.role === 'admin' ? 'เพิ่มวิชา' : 'ส่งคำขอเพิ่มวิชา'}</button></div>`);
}
async function submitOffering() {
  try {
    const r = await api('/api/offerings', { method: 'POST', body: {
      course_id: +$('of-course').value, lecturer_name: $('of-lect').value, day: +$('of-day').value,
      start_time: $('of-start').value, end_time: $('of-end').value, room: $('of-room').value, capacity: +$('of-cap').value } });
    closeModal(); toast(r.message); VIEWS.offerings();
  } catch (e) { toast(e.message, true); }
}
async function requestDeleteOffering(id, code) {
  if (!confirm(`ยืนยันการลบ/ขอลบวิชา ${code}?`)) return;
  try { const r = await api(`/api/offerings/${id}/request-delete`, { method: 'POST' }); toast(r.message); VIEWS.offerings(); }
  catch (e) { toast(e.message, true); }
}

// ----- Admin: approvals -----
VIEWS.approvals = async () => {
  const list = await api('/api/approvals');
  let h = `<div class="card"><h2>คำขอเพิ่ม/ลบรายวิชา (${list.length})</h2>`;
  if (!list.length) h += '<p class="muted">ไม่มีคำขอค้าง</p>';
  else {
    h += '<div class="table-scroll"><table><thead><tr><th>ประเภท</th><th>วิชา</th><th>เทอม</th><th>ผู้ขอ</th><th>ผู้ลงเรียน</th><th></th></tr></thead><tbody>';
    for (const o of list) h += `<tr><td>${o.status === 'pending_add' ? '<span class="pill pill-blue">ขอเพิ่ม</span>' : '<span class="pill pill-red">ขอลบ</span>'}</td>
      <td>${esc(o.code)} ${esc(o.course_name)}<br><span class="muted">${esc(o.day_name)} ${o.start_time}–${o.end_time} · ${esc(o.lecturer_name)}</span></td>
      <td>${o.term}/${o.year}</td><td>${esc(o.requester)}</td><td style="text-align:center">${o.enrolled_count}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn-sm btn-primary" onclick="decideOffering(${o.id}, true)">อนุมัติ</button>
      <button class="btn-sm btn-danger" onclick="decideOffering(${o.id}, false)">ปฏิเสธ</button></td></tr>`;
    h += '</tbody></table></div>';
  }
  $('main').innerHTML = h + '</div>';
};
async function decideOffering(id, approve) {
  let reason = '';
  if (!approve) { reason = prompt('เหตุผลที่ปฏิเสธ (ผู้ขอจะเห็นข้อความนี้):') || ''; if (!reason) return; }
  try { await api(`/api/approvals/${id}/decide`, { method: 'POST', body: { approve, reason } }); toast(approve ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'); VIEWS.approvals(); refreshNotifBadge(); }
  catch (e) { toast(e.message, true); }
}

// ----- Courses management -----
VIEWS.courses = async () => {
  const list = await api('/api/courses');
  const catTH = { general: 'ศึกษาทั่วไป', core: 'วิชาแกน', free: 'วิชาเสรี' };
  let h = `<div class="card"><h2>จัดการหลักสูตร (${list.length} วิชา)</h2>
    <div class="table-scroll"><table><thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th>หมวด</th><th style="text-align:center">น.ก.</th><th></th></tr></thead><tbody>`;
  for (const c of list) h += `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${catTH[c.category]}</td><td style="text-align:center">${c.credits}</td>
    <td style="text-align:right"><button class="btn-sm btn-danger" onclick="deleteCourse(${c.id}, '${esc(c.code)}')">ลบ</button></td></tr>`;
  h += `</tbody></table></div>
    <div class="actions-bar"><button class="btn-primary" onclick="courseModal()">+ เพิ่มวิชาในหลักสูตร</button></div>
    <p class="muted">วิชาที่มีข้อมูลเทียบโอน/การลงทะเบียนผูกอยู่ จะถูกปิดใช้งานแทนการลบจริงเพื่อป้องกันข้อมูลนักศึกษาเสียหาย</p></div>`;
  $('main').innerHTML = h;
};
function courseModal() {
  openModal(`<h2>เพิ่มวิชาในหลักสูตร</h2>
    <div class="row"><label>รหัสวิชา</label><input id="cr-code"></div>
    <div class="row"><label>ชื่อวิชา</label><input id="cr-name"></div>
    <div class="row"><label>หมวด</label><select id="cr-cat"><option value="general">วิชาศึกษาทั่วไป</option><option value="core">วิชาแกน</option><option value="free">วิชาเสรี</option></select></div>
    <div class="row"><label>หน่วยกิต</label><input id="cr-credits" type="number" value="3"></div>
    <div class="modal-actions"><button onclick="closeModal()">ยกเลิก</button><button class="btn-primary" onclick="submitCourse()">เพิ่มวิชา</button></div>`);
}
async function submitCourse() {
  try {
    await api('/api/courses', { method: 'POST', body: { code: $('cr-code').value, name: $('cr-name').value, category: $('cr-cat').value, credits: +$('cr-credits').value } });
    closeModal(); toast('เพิ่มวิชาแล้ว'); VIEWS.courses();
  } catch (e) { toast(e.message, true); }
}
async function deleteCourse(id, code) {
  if (!confirm(`ยืนยันการลบวิชา ${code}?`)) return;
  try { const r = await api(`/api/courses/${id}`, { method: 'DELETE' }); toast(r.message); VIEWS.courses(); } catch (e) { toast(e.message, true); }
}

// ----- Users management -----
VIEWS.users = async () => {
  const list = await api('/api/users');
  let h = `<div class="card"><h2>จัดการผู้ใช้ (${list.length})</h2>
    <div class="table-scroll"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>สาขา</th><th>สถานะ</th><th></th></tr></thead><tbody>`;
  for (const u of list) h += `<tr><td>${esc(u.user_code)}</td><td>${esc(u.name)}</td><td>${ROLE_TH[u.role]}</td><td class="muted">${esc(u.dept || '-')}</td>
    <td>${u.active ? '<span class="pill pill-green">ใช้งาน</span>' : '<span class="pill pill-red">ปิด</span>'}</td>
    <td style="text-align:right;white-space:nowrap"><button class="btn-sm" onclick="resetPass(${u.id}, '${esc(u.user_code)}')">รีเซ็ตรหัส</button>
    <button class="btn-sm" onclick="toggleActive(${u.id})">${u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></td></tr>`;
  h += `</tbody></table></div>
    <div class="actions-bar"><button class="btn-primary" onclick="userModal()">+ ออกบัญชีผู้ใช้ใหม่</button></div>
    <p class="muted">บัญชีใหม่จะถูกบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก</p></div>`;
  $('main').innerHTML = h;
};
async function userModal() {
  const deps = await api('/api/departments');
  openModal(`<h2>ออกบัญชีผู้ใช้ใหม่</h2>
    <div class="row"><label>รหัสนักศึกษา / รหัสพนักงาน</label><input id="us-code"></div>
    <div class="row"><label>ชื่อ-สกุล</label><input id="us-name"></div>
    <div class="row"><label>บทบาท</label><select id="us-role"><option value="student">นักศึกษา</option><option value="lecturer">อาจารย์</option><option value="officer">เจ้าหน้าที่</option><option value="counselor">อาจารย์แนะแนว</option><option value="admin">ผู้ดูแลระบบ</option></select></div>
    <div class="row"><label>สาขา</label><select id="us-dep">${deps.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
    <div class="row"><label>รหัสผ่านเริ่มต้น (อย่างน้อย 6 ตัว)</label><input id="us-pass"></div>
    <div class="modal-actions"><button onclick="closeModal()">ยกเลิก</button><button class="btn-primary" onclick="submitUser()">ออกบัญชี</button></div>`);
}
async function submitUser() {
  try {
    await api('/api/users', { method: 'POST', body: { user_code: $('us-code').value, name: $('us-name').value, role: $('us-role').value, department_id: +$('us-dep').value, password: $('us-pass').value } });
    closeModal(); toast('ออกบัญชีเรียบร้อย'); VIEWS.users();
  } catch (e) { toast(e.message, true); }
}
async function resetPass(id, code) {
  const p = prompt(`ตั้งรหัสผ่านใหม่ให้ ${code} (อย่างน้อย 6 ตัว):`);
  if (!p) return;
  try { await api(`/api/users/${id}/reset-password`, { method: 'POST', body: { password: p } }); toast('รีเซ็ตรหัสผ่านแล้ว ผู้ใช้ต้องเปลี่ยนรหัสเมื่อ login ครั้งแรก'); } catch (e) { toast(e.message, true); }
}
async function toggleActive(id) {
  try { await api(`/api/users/${id}/toggle-active`, { method: 'POST' }); VIEWS.users(); } catch (e) { toast(e.message, true); }
}

// ----- Semesters -----
VIEWS.semesters = async () => {
  const list = await api('/api/semesters');
  let h = `<div class="card"><h2>ภาคเรียน / ปีการศึกษา</h2>
    <table><thead><tr><th>เทอม/ปี</th><th>สถานะ</th><th>ลงทะเบียน</th><th></th></tr></thead><tbody>`;
  for (const s of list) h += `<tr><td><b>${s.term}/${s.year}</b></td>
    <td>${s.is_current ? '<span class="pill pill-green">เทอมปัจจุบัน</span>' : ''}</td>
    <td>${s.registration_open ? '<span class="pill pill-green">เปิด</span>' : '<span class="pill pill-gray">ปิด</span>'}</td>
    <td style="text-align:right"><button class="btn-sm" onclick="toggleReg(${s.id})">${s.registration_open ? 'ปิดลงทะเบียน' : 'เปิดลงทะเบียน'}</button></td></tr>`;
  h += `</tbody></table>
    <div class="actions-bar">
      <input id="sem-term" type="number" placeholder="เทอม (1-3)" style="width:110px">
      <input id="sem-year" type="number" placeholder="ปี พ.ศ. เช่น 2569" style="width:150px">
      <button class="btn-primary" onclick="openSemester()">เปิดเทอมใหม่</button></div></div>`;
  $('main').innerHTML = h;
};
async function openSemester() {
  try { await api('/api/semesters', { method: 'POST', body: { term: +$('sem-term').value, year: +$('sem-year').value } }); toast('เปิดเทอมใหม่แล้ว และตั้งเป็นเทอมปัจจุบัน'); VIEWS.semesters(); }
  catch (e) { toast(e.message, true); }
}
async function toggleReg(id) {
  try { await api(`/api/semesters/${id}/toggle-registration`, { method: 'POST' }); VIEWS.semesters(); } catch (e) { toast(e.message, true); }
}

// ----- Audit -----
VIEWS.audit = async () => {
  const list = await api('/api/audit');
  $('main').innerHTML = `<div class="card"><h2>ประวัติการใช้งานระบบ (audit log)</h2>
    <div class="table-scroll"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>` +
    list.map(a => `<tr><td class="muted" style="white-space:nowrap">${esc(a.created_at)}</td><td>${esc(a.user_code || '-')}</td><td>${esc(a.action)}</td><td class="muted">${esc(a.detail)}</td></tr>`).join('') +
    '</tbody></table></div></div>';
};

// ---------- Boot ----------
(async () => {
  try {
    const d = await api('/api/me');
    USER = d.user; enterApp(d.must_change_password);
  } catch (e) { $('login-page').classList.remove('hidden'); }
  $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
})();
