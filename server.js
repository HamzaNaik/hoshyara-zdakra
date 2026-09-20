// هوښیاره زده کړه — Main server file
// This one file runs everything: registration, admin approval, schedules, notes, and AI chat.

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' })); // 5mb so small note attachments can be sent as base64
app.use(express.static(path.join(__dirname, 'public'))); // serves the real website files

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Simple admin check: the app sends this password in a header for admin actions
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'not_authorized' });
  }
  next();
}

// ---------- Health check ----------
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Hoshyara Zdakra server is running' });
});

// ---------- Student registration ----------
// A student submits this form; it goes in as "pending" until Hamza approves it.
app.post('/api/register', async (req, res) => {
  try {
    const { name, father_name, school_type, grade, country, age, agreed_rules } = req.body;
    if (!name || !father_name || !grade || !country || !age || !agreed_rules) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const { data, error } = await supabase
      .from('students')
      .insert([{ name, father_name, school_type: school_type || 'other', grade, country, age, agreed_rules, status: 'pending' }])
      .select()
      .single();
    if (error) throw error;
    res.json({ student: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// A student checks their own status (approved yet or still pending)
app.get('/api/students/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json({ student: data });
  } catch (e) {
    res.status(404).json({ error: 'not_found' });
  }
});

// ---------- Admin panel endpoints (require ADMIN_PASSWORD) ----------

// See everyone waiting for approval
app.get('/api/admin/pending', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ students: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// Approve a student: this automatically creates the class (if it doesn't exist yet)
// and puts the student in it, based on the grade they wrote at registration.
app.post('/api/admin/approve/:id', requireAdmin, async (req, res) => {
  try {
    const studentId = req.params.id;
    const { data: student, error: findErr } = await supabase
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();
    if (findErr || !student) return res.status(404).json({ error: 'not_found' });

    // find or create the class for this grade
    let { data: existingClass } = await supabase
      .from('classes')
      .select('*')
      .eq('grade_label', student.grade)
      .single();

    let classId;
    if (existingClass) {
      classId = existingClass.id;
    } else {
      const { data: newClass, error: classErr } = await supabase
        .from('classes')
        .insert([{ grade_label: student.grade }])
        .select()
        .single();
      if (classErr) throw classErr;
      classId = newClass.id;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('students')
      .update({ status: 'approved', class_id: classId })
      .eq('id', studentId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    res.json({ student: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/admin/reject/:id', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ student: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// Approve every pending student in one click
app.post('/api/admin/approve-all', requireAdmin, async (req, res) => {
  try {
    const { data: pending, error } = await supabase.from('students').select('*').eq('status', 'pending');
    if (error) throw error;
    for (const student of pending) {
      let { data: existingClass } = await supabase.from('classes').select('*').eq('grade_label', student.grade).single();
      let classId;
      if (existingClass) {
        classId = existingClass.id;
      } else {
        const { data: newClass } = await supabase.from('classes').insert([{ grade_label: student.grade }]).select().single();
        classId = newClass.id;
      }
      await supabase.from('students').update({ status: 'approved', class_id: classId }).eq('id', student.id);
    }
    res.json({ approved: pending.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Suspend or remove a student for breaking the rules, with a reason on record
app.post('/api/admin/suspend/:id', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data, error } = await supabase
      .from('students')
      .update({ status: 'suspended', status_reason: reason || null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ student: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/admin/remove/:id', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data, error } = await supabase
      .from('students')
      .update({ status: 'removed', status_reason: reason || null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ student: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// Private message from admin to one specific student
app.post('/api/admin/message/:studentId', requireAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'missing_message' });
    const { data, error } = await supabase
      .from('messages')
      .insert([{ student_id: req.params.studentId, message }])
      .select()
      .single();
    if (error) throw error;
    res.json({ message: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/messages/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('student_id', req.params.studentId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json({ messages: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Classmates ----------
// Once approved, a student can see everyone else in their class.
app.get('/api/classmates/:studentId', async (req, res) => {
  try {
    const { data: me, error: meErr } = await supabase
      .from('students')
      .select('class_id, status')
      .eq('id', req.params.studentId)
      .single();
    if (meErr || !me) return res.status(404).json({ error: 'not_found' });
    if (me.status !== 'approved' || !me.class_id) {
      return res.json({ classmates: [], note: 'not_approved_yet' });
    }
    const { data: classmates, error } = await supabase
      .from('students')
      .select('id, name, father_name')
      .eq('class_id', me.class_id)
      .eq('status', 'approved');
    if (error) throw error;
    res.json({ classmates });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Schedule ----------
app.post('/api/schedule/:studentId', async (req, res) => {
  try {
    const { items } = req.body; // [{time, text}, ...]
    const { data, error } = await supabase
      .from('schedules')
      .upsert({ student_id: req.params.studentId, items, updated_at: new Date().toISOString() }, { onConflict: 'student_id' })
      .select()
      .single();
    if (error) throw error;
    res.json({ schedule: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/schedule/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('student_id', req.params.studentId)
      .maybeSingle();
    if (error) throw error;
    res.json({ schedule: data || null });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- Notes ----------
app.post('/api/notes/:studentId', async (req, res) => {
  try {
    const { text, attachment_type, attachment_url } = req.body;
    const { data, error } = await supabase
      .from('notes')
      .insert([{ student_id: req.params.studentId, text, attachment_type, attachment_url }])
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/notes/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('student_id', req.params.studentId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ notes: data });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/notes/:noteId', async (req, res) => {
  try {
    const { error } = await supabase.from('notes').delete().eq('id', req.params.noteId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ---------- AI chat (Gemini) ----------
const SYSTEM_PROMPT = `ته د 'هوښیاره زده کړه' پلاتفارم کې یو مهربان AI مرستیال یې. که یو زده کوونکی له تاسو نه وپوښتي چې تا څوک جوړ کړی یې، په یوه لنډه جمله ووایه: 'زه د حمزه نایک لخوا جوړ شوی یم.' نور معلومات مه ورکوه. ستاسو دنده پراخه ده: (۱) که زده کوونکی غواړي چې خپل ورځنی تقسیم اوقات جوړ کړي، ورسره پوښتنې وکړئ او یو منظم تقسیم اوقات ورته وړاندې کړئ. (۲) که د درسونو (انګلیسي، ریاضي، او نور) په اړه پوښتنه کوي، ورسره مرسته وکړئ. (۳) که یې پوښتنه له زده کړې سره تړاو ونلري، هغې ته هم ریښتینی، مفصل، او مرستندویه ځواب ورکړئ. تل په پښتو ژبه، مهربانه، او روښانه ډول ځواب ورکړئ.`;

app.post('/api/ai-chat', async (req, res) => {
  try {
    const { history } = req.body; // [{role: 'user'|'model', text: '...'}, ...]
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', systemInstruction: SYSTEM_PROMPT });

    const chat = model.startChat({
      history: (history || []).slice(0, -1).map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }],
      })),
    });

    const lastMessage = history[history.length - 1].text;
    const result = await chat.sendMessage(lastMessage);
    const reply = result.response.text();
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ai_error' });
  }
});

// ---------- Admin dashboard: AI-composed summary ----------
// Gemini looks at the real numbers and writes a short, human summary in Pashto.
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const { data: allStudents, error } = await supabase.from('students').select('*');
    if (error) throw error;

    const { data: classes } = await supabase.from('classes').select('*');

    const pending = allStudents.filter(s => s.status === 'pending');
    const approved = allStudents.filter(s => s.status === 'approved');
    const byGrade = {};
    approved.forEach(s => { byGrade[s.grade] = (byGrade[s.grade] || 0) + 1; });

    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
    const prompt = `ته د یو ښوونځي مدیر لپاره لنډ او مفید راپور لیکونکی یې. لاندې ارقام دي، پرې بنسټ یو ډېر لنډ (۲-۳ جملې)، دوستانه، مفید لنډیز په پښتو ژبه ولیکه چې مدیر ته وښیي اوسنی حالت څه دی. یوازې متن ولیکه، هیڅ نور شکل مه کاروه.
ټول زده کوونکي: ${allStudents.length}
منتظر تایید: ${pending.length}
تایید شوي: ${approved.length}
ټولګي: ${JSON.stringify(byGrade)}`;

    let summary = '';
    try {
      const result = await model.generateContent(prompt);
      summary = result.response.text();
    } catch (aiErr) {
      summary = `اوس مهال ${allStudents.length} زده کوونکي ثبت شوي، ${pending.length} یې منتظر تایید دي.`;
    }

    res.json({
      summary,
      totals: { all: allStudents.length, pending: pending.length, approved: approved.length },
      byGrade,
      pendingStudents: pending,
      classes: classes || [],
      approvedStudents: approved,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Hoshyara Zdakra server running on port ${PORT}`);
});
