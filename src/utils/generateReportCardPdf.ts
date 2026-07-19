import PDFDocument from "pdfkit";
import { Response } from "express";
import path from "path";

const LOGO_PATH = path.join(__dirname, "../assets/logo.png");

interface SubjectResult {
  nameEnglish: string;
  nameArabic?: string;
  currentTermScore: number | null;
  cumulativeAverage: number | null;
  grade: string | null;
  remark: string | null;
  remarkArabic: string | null;
}

interface ReportCardData {
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

// Draws ONE student's report card into the given PDFDocument.
// Kept separate from the HTTP response logic so the bulk endpoint
// can call this once per student into the same PDF stream.
export const drawReportCard = (doc: PDFKit.PDFDocument, data: ReportCardData) => {
  const { student, term, subjects, overallTotal, overallPercentage, position, result } = data;


  try {
    doc.image(LOGO_PATH, 480, 40, { width: 70 });
  } catch (err) {
    console.warn("Could not load logo image:", (err as Error).message);
  }

  doc.fontSize(16).text("INSTITUTE OF ARABIC AND ISLAMIC STUDIES", { align: "center" });
  doc.fontSize(10).text(`REPORT SHEET FOR TERM ${term.termNumber} - ${term.session}`, {
    align: "center",
  });
  doc.moveDown();

  doc.fontSize(11);
  doc.text(`Name: ${student.name}`);
  doc.text(`Class: ${student.class}${student.arm ? " " + student.arm : ""}`);
  if (student.numberInClass) doc.text(`No. in Class: ${student.numberInClass}`);
  doc.text(`Gender: ${student.gender}`);
  doc.moveDown();

  // simple table header
  doc.font("Helvetica-Bold");
  doc.text("Subject", 50, doc.y, { continued: true, width: 180 });
  doc.text("Score", 240, doc.y, { continued: true, width: 60 });
  doc.text("Grade", 310, doc.y, { continued: true, width: 60 });
  doc.text("Remark", 380);
  doc.font("Helvetica");

  subjects.forEach((s) => {
    const label = s.nameArabic ? `${s.nameEnglish} ${s.nameArabic}` : s.nameEnglish;
    doc.text(label, 50, doc.y, { continued: true, width: 180 });
    doc.text(String(s.cumulativeAverage ?? "-"), 240, doc.y, { continued: true, width: 60 });
    doc.text(s.grade ?? "-", 310, doc.y, { continued: true, width: 60 });
    doc.text(s.remark ?? "-", 380);
  });

  doc.moveDown();
  doc.font("Helvetica-Bold");
  doc.text(`Overall Total: ${overallTotal}`);
  doc.text(`Percentage: ${overallPercentage}%`);
  doc.text(`Position: ${position ?? "-"}`);
  doc.text(`Result: ${result}`);
  doc.font("Helvetica");

  doc.moveDown();
  doc.text("Class Teacher's Comment: _______________________");
  doc.moveDown();
  doc.text("Principal's Comment: _______________________");
};