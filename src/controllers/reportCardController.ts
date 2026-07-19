import { Response } from "express";
import Student from "../models/Student";
import Subject from "../models/Subject";
import Score from "../models/Score";
import Term from "../models/Term";
import GradingScale from "../models/GradingScale";
import { AuthRequest } from "../middleware/auth";
import { getClassCumulativePositions } from "./broadsheetController";

// Returns the full report card data object, or null if the student/term
// can't be found. No `req`/`res` here on purpose — this is a plain function
// so both getReportCard (JSON) and the PDF controllers can reuse it.
export const buildReportCardData = async (
  studentId: string,
  termId: string,
  scaleId?: string
) => {
  if (!studentId || !termId) {
    return null;
  }

  const student = await Student.findById(studentId).populate("class");
  if (!student) return null;

  const currentTerm = await Term.findById(termId);
  if (!currentTerm) return null;

  // find every term in the same session up to and including the current one
  // e.g. if currentTerm.termNumber = 3, this pulls terms 1, 2, and 3
  const priorTerms = await Term.find({
    session: currentTerm.session,
    termNumber: { $lte: currentTerm.termNumber },
  }).sort({ termNumber: 1 });

  const priorTermIds = priorTerms.map((t) => t._id);

  const subjects = await Subject.find({
    class: (student.class as any)._id,
  }).sort({
    nameEnglish: 1,
  });

  const scoresBySubject = await Score.find({
    student: studentId,
    subject: { $in: subjects.map((s) => s._id) },
    term: { $in: priorTermIds },
  });

  // group scores by subject so we can average across the relevant terms
  const grouped = new Map<string, number[]>();
  scoresBySubject.forEach((sc) => {
    const key = sc.subject.toString();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(sc.total);
  });

  const gradingScale = scaleId ? await GradingScale.findById(scaleId) : null;

  const subjectResults = subjects.map((subject) => {
    const scores = grouped.get(subject._id.toString()) || [];
    // term 1: just that term's score. term 2: avg of term1+2. term 3: avg of all 3.
    const cumulativeAverage =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;

    let grade = null;
    let remark = null;
    let remarkArabic = null;

    if (gradingScale && cumulativeAverage !== null) {
      const band = gradingScale.bands.find(
        (b) =>
          cumulativeAverage >= b.minScore && cumulativeAverage <= b.maxScore
      );
      if (band) {
        grade = band.grade;
        remark = band.remark;
        remarkArabic = band.remarkArabic;
      }
    }

    return {
      subject: subject._id,
      nameEnglish: subject.nameEnglish,
      nameArabic: subject.nameArabic,
      // the current term's own score, shown separately from the cumulative
      currentTermScore:
        scoresBySubject.find((sc) => sc.term.toString() === termId)?.total ??
        null,
      cumulativeAverage:
        cumulativeAverage !== null
          ? Math.round(cumulativeAverage * 100) / 100
          : null,
      grade,
      remark,
      remarkArabic,
    };
  });

  const validAverages = subjectResults
    .map((s) => s.cumulativeAverage)
    .filter((v): v is number => v !== null);

  const overallTotal = validAverages.reduce((a, b) => a + b, 0);
  const overallPercentage =
    validAverages.length > 0 ? overallTotal / validAverages.length : 0;

  const classId = (student.class as any)._id.toString();
  const positionMap = await getClassCumulativePositions(classId, termId);
  const position = positionMap.get(studentId) ?? null;

  return {
    student: {
      id: student._id,
      name: student.name,
      gender: student.gender,
      numberInClass: student.numberInClass,
      class: (student.class as any).name,
      arm: (student.class as any).arm || null, // omit on report card if null
    },
    term: {
      session: currentTerm.session,
      termNumber: currentTerm.termNumber,
    },
    subjects: subjectResults,
    overallTotal: Math.round(overallTotal * 100) / 100,
    overallPercentage: Math.round(overallPercentage * 100) / 100,
    position,
    result: overallPercentage >= 50 ? "Pass" : "Fail",
  };
};

// GET /api/report-card?student=<id>&term=<termId>&gradingScale=<scaleId>
export const getReportCard = async (req: AuthRequest, res: Response) => {
  try {
    const { student, term, gradingScale } = req.query;
    const data = await buildReportCardData(
      student as string,
      term as string,
      gradingScale as string
    );
    if (!data)
      return res.status(404).json({ message: "Student or term not found" });
    res.status(200).json(data);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Server error", error: (err as Error).message });
  }
};