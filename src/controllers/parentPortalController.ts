import { Response } from "express";
import User from "../models/User";
import Term from "../models/Term";
import PDFDocument from "pdfkit";
import { AuthRequest } from "../middleware/auth";
import { buildReportCardData } from "./reportCardController";
import { drawReportCard } from "../utils/generateReportCardPdf";

// Shared guard: confirms the logged-in parent actually has a linkedStudent,
// and returns that student's ID — ignoring whatever the request tries to pass.
// This is the whole point of this file: a parent's own account already
// determines which student they can see, it's never taken from the request.
const getLinkedStudentId = async (userId: string): Promise<string | null> => {
  const user = await User.findById(userId);
  if (!user || !user.linkedStudent) return null;
  return user.linkedStudent.toString();
};

// GET /api/parent-portal/report-card?term=<termId>&gradingScale=<scaleId>
// Note: no `student` param accepted here at all — deliberately.
export const getMyChildReportCard = async (req: AuthRequest, res: Response) => {
  try {
    const { term, gradingScale } = req.query;
    if (!term) return res.status(400).json({ message: "term is required" });

    const studentId = await getLinkedStudentId(req.user!.id);
    if (!studentId) {
      return res.status(403).json({ message: "No student linked to this account" });
    }

    const data = await buildReportCardData(studentId, term as string, gradingScale as string);
    if (!data) return res.status(404).json({ message: "Report card not found" });

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

// GET /api/parent-portal/report-card/pdf?term=<termId>&gradingScale=<scaleId>
export const downloadMyChildReportCardPdf = async (req: AuthRequest, res: Response) => {
  try {
    const { term, gradingScale } = req.query;
    if (!term) return res.status(400).json({ message: "term is required" });

    const studentId = await getLinkedStudentId(req.user!.id);
    if (!studentId) {
      return res.status(403).json({ message: "No student linked to this account" });
    }

    const data = await buildReportCardData(studentId, term as string, gradingScale as string);
    if (!data) return res.status(404).json({ message: "Report card not found" });

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${data.student.name.replace(/\s+/g, "_")}_report_card.pdf`
    );
    doc.pipe(res);
    drawReportCard(doc, data);
    doc.end();
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

// GET /api/parent-portal/terms  — so the frontend can populate a term
// dropdown without the parent needing admin-level access to /api/terms
// (if you haven't built a general terms list route yet, this covers it)
export const getAvailableTerms = async (_req: AuthRequest, res: Response) => {
  try {
    const terms = await Term.find().sort({ session: -1, termNumber: -1 });
    res.status(200).json(terms);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};