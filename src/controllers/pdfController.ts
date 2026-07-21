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

    const reportData = await buildReportCardData(
      studentId as string,
      term as string,
      gradingScale as string
    );

    if (!reportData) return res.status(404).json({ message: "Report card data not found" });

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");

    // Content-Disposition headers must be ASCII-safe. A student's name
    // may contain Arabic script or other non-ASCII characters, which
    // would crash res.setHeader outright. RFC 5987's filename* syntax
    // lets us send a UTF-8 filename safely via percent-encoding, with a
    // plain ASCII fallback for older clients that don't support it.
    const safeAsciiFallback = "report_card.pdf";
    const encodedName = encodeURIComponent(
      `${reportData.student.name}_report_card.pdf`
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeAsciiFallback}"; filename*=UTF-8''${encodedName}`
    );

    doc.pipe(res);
    drawReportCard(doc, reportData);
    doc.end();
  } catch (err) {
    res
      .status(500)
      .json({ message: "Server error", error: (err as Error).message });
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