-- هوښیاره زده کړه (Hoshyara Zdakra) — Database schema
-- HOW TO USE: In your Supabase project, go to "SQL Editor" -> "New query",
-- paste this entire file, and click "Run". This creates all the tables.

-- Classes table: created automatically the first time a grade is approved
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  grade_label text not null unique,
  created_at timestamptz not null default now()
);

-- Students table: everyone who has registered, pending or approved
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  father_name text not null,
  school_type text not null check (school_type in ('private', 'public')),
  grade text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  class_id uuid references classes(id),
  created_at timestamptz not null default now()
);

-- Schedules table: one row per student's saved daily schedule
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  items jsonb not null, -- e.g. [{"time":"07:00","text":"مکتب ته ځم"}, ...]
  updated_at timestamptz not null default now()
);

-- Notes table: one row per note a student writes
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  text text,
  attachment_type text check (attachment_type in ('image', 'pdf', 'audio', null)),
  attachment_url text,
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_students_status on students(status);
create index if not exists idx_students_class on students(class_id);
create index if not exists idx_schedules_student on schedules(student_id);
create index if not exists idx_notes_student on notes(student_id);

-- Announcements table: messages the admin (Hamza) sends to all students
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);

-- Run this if you already created the students table earlier, to add the new fields:
alter table students add column if not exists country text;
alter table students add column if not exists age int;
alter table students add column if not exists agreed_rules boolean not null default false;
alter table students add column if not exists status_reason text;
alter table students drop constraint if exists students_status_check;
alter table students add constraint students_status_check check (status in ('pending', 'approved', 'rejected', 'suspended', 'removed'));

alter table students drop constraint if exists students_school_type_check;
alter table students add constraint students_school_type_check check (school_type in ('private', 'public', 'other'));
alter table students alter column school_type set default 'other';
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
