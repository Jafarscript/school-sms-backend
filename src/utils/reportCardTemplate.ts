import fs from "fs";
import path from "path";

const LOGO_PATH = path.join(__dirname, "../assets/logo.png");
const FONT_PATH = path.join(__dirname, "../assets/fonts/Amiri-Regular.ttf");

// Read once at module load, not per-request — these files don't change
// between requests, so re-reading them on every PDF generation would be
// wasted disk I/O.
const logoBase64 = fs.existsSync(LOGO_PATH)
  ? fs.readFileSync(LOGO_PATH).toString("base64")
  : "";
const fontBase64 = fs.existsSync(FONT_PATH)
  ? fs.readFileSync(FONT_PATH).toString("base64")
  : "";

interface SubjectResult {
  nameEnglish: string;
  nameArabic?: string;
  ca: number | null;
  exam: number | null;
  currentTermScore: number | null;
  priorPeriodValue: number | null;
  cumulativeAverage: number | null;
  grade: string | null;
  remark: string | null;
  remarkArabic: string | null;
}

export interface ReportCardData {
  student: {
    name: string;
    gender: string;
    numberInClass?: number;
    class: string;
    arm: string | null;
  };
  term: { session: string; termNumber: number };
  subjects: SubjectResult[];
  overallTotal: number;
  overallPercentage: number;
  position: number | null;
  result: string;
}

// Shared CSS + font-face, injected once per document (not per report card,
// even in bulk mode) since @font-face only needs declaring once.
const sharedStyles = `
  @font-face {
    font-family: 'Amiri';
    src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', serif; color: #111; }
  .arabic { font-family: 'Amiri', serif; direction: rtl; }
  .sheet {
    width: 780px;
    margin: 0 auto;
    border: 3px solid #16a34a;
    padding: 16px;
    page-break-after: always;
  }
  .sheet:last-child { page-break-after: auto; }
  .header { text-align: center; position: relative; margin-bottom: 8px; }
  .header .logo {
    position: absolute; top: 0; right: 0; width: 70px; height: 70px;
  }
  .header .school-name-ar {
    font-family: 'Amiri', serif; font-size: 28px; color: #1e3a8a; font-weight: bold;
  }
  .header .school-name-en {
    font-size: 13px; font-weight: bold; margin-top: 2px;
  }
  .header .address { font-size: 11px; font-weight: bold; margin-top: 2px; }
  .title-bar {
    text-align: center; font-size: 12px; font-weight: bold; color: #1e3a8a;
    margin: 8px 0; display: flex; justify-content: center; gap: 6px;
  }
  .title-bar .ar { font-family: 'Amiri', serif; }

  .info-section { display: flex; border: 1px solid #000; margin-bottom: 6px; }
  .attendance { flex: 1; border-right: 1px solid #000; font-size: 10px; }
  .attendance-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 8px; border-bottom: 1px solid #ddd;
  }
  .attendance-row .ar { font-family: 'Amiri', serif; }

  .student-info { flex: 1; }
  .student-info-row {
    display: flex; border-bottom: 1px solid #000; height: 34px;
  }
  .student-info-row:last-child { border-bottom: none; }
  .student-info-row .value {
    flex: 2; display: flex; align-items: center; justify-content: center;
    font-weight: bold; font-size: 13px; border-right: 1px solid #000;
  }
  .student-info-row .label {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: bold; text-align: center;
  }

  table.subjects { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  table.subjects th, table.subjects td {
    border: 1px solid #000; padding: 4px 6px; text-align: center;
  }
  table.subjects th { font-size: 9px; font-weight: bold; background: #fafafa; }
  table.subjects td.subject-name { text-align: left; font-weight: bold; }
  table.subjects td.subject-name .ar { font-family: 'Amiri', serif; float: right; }
  table.subjects tr.total-row td { font-weight: bold; }

  .bottom-section { display: flex; margin-top: 6px; gap: 0; border: 1px solid #000; }
  .bottom-box {
    flex: 1; border-right: 1px solid #000; font-size: 11px;
  }
  .bottom-box:last-child { border-right: none; }
  .bottom-box .row {
    display: flex; border-bottom: 1px solid #000; height: 30px;
  }
  .bottom-box .row:last-child { border-bottom: none; }
  .bottom-box .row .label {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font-weight: bold; background: #fafafa; font-size: 10px;
  }
  .bottom-box .row .val {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font-weight: bold;
  }

  .comment-section { margin-top: 6px; border: 1px solid #000; }
  .comment-row { display: flex; border-bottom: 1px solid #000; min-height: 40px; }
  .comment-row:last-child { border-bottom: none; }
  .comment-row .comment-label {
    flex: 1; display: flex; align-items: center; justify-content: center;
    text-align: center; font-size: 10px; font-weight: bold; border-right: 1px solid #000;
    padding: 4px;
  }
  .comment-row .comment-value {
    flex: 2; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: bold; text-align: center; padding: 4px;
  }
`;

// Builds ONE report card's HTML block (the .sheet div). Used directly for
// single downloads, and looped for bulk — each one gets page-break-after
// via CSS so Puppeteer paginates automatically without extra logic.
const buildSheetHtml = (data: ReportCardData): string => {
  const { student, term, subjects, overallTotal, overallPercentage, position, result } = data;

  // term 1 has no cascade columns at all (nothing prior exists yet).
  // term 2 and term 3 both show a two-column pair: the value BEFORE this
  // term was folded in, then the value AFTER — but the pair only ever
  // exists for term 2 and term 3, never both pairs on the same sheet.
  const showCascadeColumns = term.termNumber === 2 || term.termNumber === 3;

  const subjectRows = subjects
    .map(
      (s) => `
      <tr>
        <td class="subject-name">${s.nameEnglish} ${s.nameArabic ? `<span class="ar">${s.nameArabic}</span>` : ""}</td>
        <td>${s.ca ?? "-"}</td>
        <td>${s.exam ?? "-"}</td>
        <td>${s.currentTermScore ?? "-"}</td>
        ${showCascadeColumns ? `<td>${s.priorPeriodValue ?? "-"}</td>` : ""}
        ${showCascadeColumns ? `<td>${s.cumulativeAverage ?? "-"}</td>` : ""}
        <td>${s.cumulativeAverage ?? "-"}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="sheet">
      <div class="header">
        ${logoBase64 ? `<img class="logo" src="data:image/png;base64,${logoBase64}" />` : ""}
        <div class="school-name-ar">معهد التعليم العربي الإسلامي</div>
        <div class="school-name-en">INSTITUTE OF ARABIC AND ISLAMIC STUDIES</div>
        <div class="address">18/20 ABEWALE BELLO STREET, OFF AILEGUN ROAD,<br/>49, LAFENWA STREET, EJIGBO, LAGOS. TEL: 08023299665</div>
      </div>

      <div class="title-bar">
        <span class="ar">كشف درجات الفترة ${term.termNumber === 1 ? "الأولى" : term.termNumber === 2 ? "الثانية" : "الثالثة"}</span>
        <span>REPORT SHEET FOR ${term.termNumber === 1 ? "1ST" : term.termNumber === 2 ? "2ND" : "3RD"} TERM ${term.session} ACADEMIC SESSION</span>
      </div>

      <div class="info-section">
        <div class="attendance">
          <div class="attendance-row"><span class="ar">الحضور والغياب</span><span>ATTENDANCE</span></div>
          <div class="attendance-row"><span class="ar">عدد أيام الدوام</span><span>No. of times school opened</span></div>
          <div class="attendance-row"><span class="ar">نسبة الحضور</span><span>No. of times present</span></div>
          <div class="attendance-row"><span class="ar">نسبة الغياب</span><span>No. of times absent</span></div>
          <div class="attendance-row"><span class="ar">بدء الدراسة</span><span>Date School resumed</span></div>
          <div class="attendance-row"><span class="ar">ختم الدراسة</span><span>Date School closes</span></div>
          <div class="attendance-row"><span class="ar">العودة إلى الدراسة</span><span>Next resumption</span></div>
        </div>
        <div class="student-info">
          <div class="student-info-row">
            <div class="value arabic">${student.name}</div>
            <div class="label">الاسم<br/>NAME</div>
          </div>
          <div class="student-info-row">
            <div class="value arabic">${student.class}</div>
            <div class="label">الصف<br/>CLASS</div>
          </div>
          <div class="student-info-row">
            <div class="value">${student.numberInClass ?? "-"}</div>
            <div class="label">عدد الطلاب<br/>NO IN CLASS</div>
          </div>
          ${
            student.arm
              ? `<div class="student-info-row">
                  <div class="value">${student.arm}</div>
                  <div class="label">الشعبة<br/>DIVISION</div>
                </div>`
              : ""
          }
          <div class="student-info-row">
            <div class="value">${student.gender}</div>
            <div class="label">الجنس<br/>GENDER</div>
          </div>
        </div>
      </div>

      <table class="subjects">
        <thead>
          <tr>
            <th style="width: 26%">المواد : SUBJECT</th>
            <th>CA: مذ<br/>40</th>
            <th>EXAM :متح<br/>60</th>
            <th>TOTAL : محص<br/>100</th>
            ${
              term.termNumber === 2
                ? `<th>محصلة الفترة الأولى<br/>1st term total</th>
                   <th>محصلة الفترة الأولى والثانية<br/>1st and 2nd term total</th>`
                : ""
            }
            ${
              term.termNumber === 3
                ? `<th>محصلة الفترة الثانية<br/>2nd term total</th>
                   <th>محصلة الفترة الثانية والثالثة<br/>2nd and 3rd term total</th>`
                : ""
            }
            <th>وسطى الدرجات<br/>Average marks</th>
          </tr>
        </thead>
        <tbody>
          ${subjectRows}
          <tr class="total-row">
            <td class="subject-name">المجموع الكلي : TOTAL</td>
            <td></td><td></td>
            <td>${overallTotal}</td>
            ${showCascadeColumns ? `<td></td><td></td>` : ""}
            <td></td>
          </tr>
        </tbody>
      </table>

      <div class="bottom-section">
        <div class="bottom-box">
          <div class="row"><div class="label">الترتيب<br/>POSITION</div><div class="val">${position ?? "-"}</div></div>
          <div class="row"><div class="label">النتيجة<br/>RESULT</div><div class="val">${result}</div></div>
        </div>
        <div class="bottom-box">
          <div class="row"><div class="label" style="flex:2">1ST الأولى : 1</div></div>
          <div class="row"><div class="label" style="flex:2">2ND الثانية : 2</div></div>
          <div class="row"><div class="label" style="flex:2">3RD الثالثة : 3</div></div>
          <div class="row"><div class="label" style="flex:2">CUMULATIVE AVERAGE</div><div class="val">${overallPercentage}</div></div>
        </div>
        <div class="bottom-box">
          <div class="row"><div class="label">النسبة المئوية<br/>PERCENTAGE</div><div class="val">${overallPercentage}%</div></div>
          <div class="row"><div class="label">التقدير<br/>GRADE</div><div class="val">${subjects[0]?.remark ?? "-"}</div></div>
        </div>
      </div>

      <div class="comment-section">
        <div class="comment-row">
          <div class="comment-label">تعليق وتوقيع أستاذ الصف<br/>CLASS TEACHER'S COMMENT AND SIGNATURE</div>
          <div class="comment-value"></div>
        </div>
        <div class="comment-row">
          <div class="comment-label">تعليق و توقيع الوكيل<br/>PRINCIPAL'S COMMENT AND SIGNATURE</div>
          <div class="comment-value"></div>
        </div>
      </div>
    </div>
  `;
};

// Single report card — one .sheet div, one page.
export const buildSingleReportCardHtml = (data: ReportCardData): string => `
  <html><head><style>${sharedStyles}</style></head>
  <body>${buildSheetHtml(data)}</body></html>
`;

// Bulk — many .sheet divs, each auto-paginated via CSS page-break-after.
export const buildBulkReportCardHtml = (dataList: ReportCardData[]): string => `
  <html><head><style>${sharedStyles}</style></head>
  <body>${dataList.map(buildSheetHtml).join("")}</body></html>
`;