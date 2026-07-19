import { Response } from "express";
import PDFDocument from "pdfkit";
import Student from "../models/Student";
import { AuthRequest } from "../middleware/auth";
import { drawReportCard } from "../utils/generateReportCardPdf";
import { buildReportCardData } from "./reportCardController";


// GET /api/report-card/pdf?student=<id>&term=<termId>&gradingScale=<scaleId>
// Generates ONE student's report card as a downloadable PDF.
export const downloadSingleReportCardPdf = async (req: AuthRequest, res: Response) => {
  try {
    const { student: studentId, term, gradingScale } = req.query;

    // reuse the exact same logic from Day 6 by calling our own endpoint's
    // underlying function directly instead of duplicating it — see note below
    const reportData = await buildReportCardData(studentId as string, term as string, gradingScale as string);

    if (!reportData) return res.status(404).json({ message: "Report card data not found" });

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${reportData.student.name.replace(/\s+/g, "_")}_report_card.pdf`
    );
    doc.pipe(res);
    drawReportCard(doc, reportData);
    doc.end();
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

// GET /api/report-card/pdf/bulk?class=<classId>&term=<termId>&gradingScale=<scaleId>
// Generates ONE PDF containing every student in the class, one report card per page.
export const downloadBulkReportCardPdf = async (req: AuthRequest, res: Response) => {
  try {
    const { class: classId, term, gradingScale } = req.query;

    if (!classId || !term) {
      return res.status(400).json({ message: "class and term are required" });
    }

    const students = await Student.find({ class: classId }).sort({ numberInClass: 1 });
    if (students.length === 0) {
      return res.status(404).json({ message: "No students found in this class" });
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=class_report_cards.pdf`);
    doc.pipe(res);

    for (let i = 0; i < students.length; i++) {
      const reportData = await buildReportCardData(
        students[i]._id.toString(),
        term as string,
        gradingScale as string
      );
      if (!reportData) continue;

      if (i > 0) doc.addPage(); // new page per student, except the first
      drawReportCard(doc, reportData);
    }

    doc.end();
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};