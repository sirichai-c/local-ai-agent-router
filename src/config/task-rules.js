const TASK_CATEGORIES = Object.freeze([
  'coding',
  'debugging',
  'refactor',
  'git',
  'review',
  'architecture',
  'multiFile',
  'terminal',
  'autonomous',
  'smallChange',
]);

function defineRules(rules) {
  return Object.freeze(rules.map((rule) => Object.freeze({
    keywords: Object.freeze([...rule.keywords]),
    weight: rule.weight,
  })));
}

const taskRules = Object.freeze({
  coding: defineRules([
    {
      keywords: [
        'implement', 'create', 'build', 'develop', 'feature', 'functionality',
        'เขียนโค้ด', 'สร้าง', 'พัฒนา', 'เพิ่มฟีเจอร์',
      ],
      weight: 45,
    },
    {
      keywords: [
        'code', 'api', 'apis', 'express', 'controller', 'service', 'endpoint',
        'crud', 'backend', 'frontend', 'โค้ด', 'ฟังก์ชัน',
      ],
      weight: 30,
    },
  ]),
  debugging: defineRules([
    {
      keywords: [
        'bug', 'bugs', 'debug', 'crash', 'exception', 'หาบั๊ก', 'แก้บั๊ก',
        'บั๊ก', 'ข้อผิดพลาด',
      ],
      weight: 75,
    },
    {
      keywords: [
        'error', 'failing', 'failure', 'broken', 'incorrect behavior',
        'not working', 'ทำงานผิด', 'ใช้ไม่ได้',
      ],
      weight: 40,
    },
  ]),
  refactor: defineRules([
    {
      keywords: [
        'refactor', 'refactoring', 'ปรับโครงสร้าง', 'จัดโครงสร้างใหม่',
      ],
      weight: 90,
    },
    {
      keywords: [
        'cleanup code', 'clean up code', 'restructure', 'reduce duplication',
        'จัดระเบียบโค้ด', 'ลดโค้ดซ้ำ',
      ],
      weight: 50,
    },
  ]),
  git: defineRules([
    {
      keywords: [
        'git diff', 'git', 'commit', 'branch', 'merge', 'rebase', 'repository', 'repo',
        'เช็ก diff', 'ตรวจ diff', 'คอมมิต', 'บรานช์', 'รีเบส',
      ],
      weight: 90,
    },
  ]),
  review: defineRules([
    {
      keywords: ['code review', 'review code', 'review', 'รีวิวโค้ด', 'ตรวจโค้ด'],
      weight: 80,
    },
    {
      keywords: ['audit', 'inspect changes', 'analyze changes', 'ตรวจสอบการเปลี่ยนแปลง'],
      weight: 60,
    },
  ]),
  architecture: defineRules([
    {
      keywords: [
        'architecture', 'system design', 'design architecture',
        'software design', 'สถาปัตยกรรม', 'ออกแบบระบบ', 'ออกแบบ architecture',
      ],
      weight: 90,
    },
    {
      keywords: ['component design', 'module boundaries', 'โครงสร้างระบบ'],
      weight: 55,
    },
  ]),
  multiFile: defineRules([
    {
      keywords: [
        'multiple files', 'multi-file', 'across files', 'whole project',
        'entire project', 'codebase', 'ทั้ง project', 'ทั้งโปรเจกต์',
        'หลายไฟล์', 'ทั้ง codebase',
      ],
      weight: 80,
    },
  ]),
  terminal: defineRules([
    {
      keywords: [
        'npm', 'shell', 'powershell', 'docker', 'terminal', 'cli',
        'command line', 'command-line', 'คำสั่ง', 'เทอร์มินัล',
      ],
      weight: 80,
    },
  ]),
  autonomous: defineRules([
    {
      keywords: [
        'end-to-end', 'end to end', 'complete everything', 'handle everything',
        'fully implement', 'finish everything', 'ทั้งหมด', 'ให้เสร็จ',
        'ดำเนินการเอง', 'ตั้งแต่ต้นจนจบ',
      ],
      weight: 85,
    },
  ]),
  smallChange: defineRules([
    {
      keywords: [
        'small change', 'minor edit', 'single file', 'one file',
        'ไฟล์เดียว', 'แก้เล็กน้อย', 'เปลี่ยนข้อความ', 'แก้ข้อความ',
      ],
      weight: 90,
    },
  ]),
});

const FALLBACK_CLASSIFICATION = Object.freeze({
  coding: 40,
});

module.exports = {
  FALLBACK_CLASSIFICATION,
  TASK_CATEGORIES,
  taskRules,
};
