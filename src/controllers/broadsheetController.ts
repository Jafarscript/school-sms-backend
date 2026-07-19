import { Response } from "express";
import Student from "../models/Student";
import Subject from "../models/Subject";
import Score from "../models/Score";
import { AuthRequest } from "../middleware/auth";
import { computePositions } from "../utils/ranking";
import Term from "../models/Term";

// GET /api/broadsheet?class=<classId>&term=<termId>
// Returns every student in the class, their score in every subject
// assigned to that class, their total, and their overall position.
export const getBroadsheet = async (req: AuthRequest, res: Response) => {
  try {
    const { class: classId, term } = req.query;

    if (!classId || !term) {
      return res.status(400).json({ message: "class and term are required" });
    }

    const students = await Student.find({ class: classId }).sort({ name: 1 });
    const subjects = await Subject.find({ class: classId }).sort({
      nameEnglish: 1,
    });

    if (students.length === 0 || subjects.length === 0) {
      return res.status(200).json({ subjects, rows: [] });
    }

    const studentIds = students.map((s) => s._id);
    const subjectIds = subjects.map((s) => s._id);

    const scores = await Score.find({
      student: { $in: studentIds },
      subject: { $in: subjectIds },
      term,
    });

    // index scores by "studentId-subjectId" for fast lookup while building rows
    const scoreMap = new Map<string, number>();
    scores.forEach((sc) => {
      scoreMap.set(
        `${sc.student.toString()}-${sc.subject.toString()}`,
        sc.total,
      );
    });

    // build one row per student: their score in each subject + grand total
    const rows = students.map((student) => {
      const subjectScores = subjects.map((subject) => {
        const key = `${student._id.toString()}-${subject._id.toString()}`;
        return {
          subject: subject._id,
          nameEnglish: subject.nameEnglish,
          nameArabic: subject.nameArabic,
          score: scoreMap.get(key) ?? null, // null = not yet entered by subject teacher
        };
      });

      const enteredScores = subjectScores.filter((s) => s.score !== null) as {
        score: number;
      }[];
      const total = enteredScores.reduce((sum, s) => sum + s.score, 0);
      const average =
        enteredScores.length > 0 ? total / enteredScores.length : 0;

      return {
        student: student._id,
        name: student.name,
        numberInClass: student.numberInClass,
        subjectScores,
        total,
        average: Math.round(average * 100) / 100,
        allSubjectsEntered: enteredScores.length === subjects.length,
      };
    });

    // rank by total, descending — standard "1st, 2nd, 3rd" position with tie handling
    // (two students with the same total share the same position, next position skips)
    const ranked = computePositions(
      rows.map((r) => ({ studentId: r.student.toString(), score: r.total })),
    );
    const positionMap = new Map(ranked.map((r) => [r.studentId, r.position]));

    const positioned = rows.map((row) => ({
      ...row,
      position: positionMap.get(row.student.toString())!,
    }));

    // re-sort back to numberInClass/name order for the broadsheet table view,
    // now that each row carries its computed position
    const finalRows = positioned.sort(
      (a, b) =>
        (a.numberInClass ?? 0) - (b.numberInClass ?? 0) ||
        a.name.localeCompare(b.name),
    );

    res.status(200).json({ subjects, rows: finalRows });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Server error", error: (err as Error).message });
  }
};

// Computes cumulative-average position for every student in a class,
// across all terms up to and including the given term (same averaging
// rule as the report card: term1 alone, term1+2 avg, term1+2+3 avg).
export const getClassCumulativePositions = async (
  classId: string,
  termId: string
): Promise<Map<string, number>> => {
  const currentTerm = await Term.findById(termId);
  if (!currentTerm) return new Map();

  const priorTerms = await Term.find({
    session: currentTerm.session,
    termNumber: { $lte: currentTerm.termNumber },
  });
  const priorTermIds = priorTerms.map((t) => t._id);

  const students = await Student.find({ class: classId });
  const subjects = await Subject.find({ class: classId });

  const scores = await Score.find({
    student: { $in: students.map((s) => s._id) },
    subject: { $in: subjects.map((s) => s._id) },
    term: { $in: priorTermIds },
  });

  // group scores per student across all their subjects+terms, then average
  const byStudent = new Map<string, number[]>();
  scores.forEach((sc) => {
    const key = sc.student.toString();
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key)!.push(sc.total);
  });

  const rankInput = students.map((s) => {
    const vals = byStudent.get(s._id.toString()) || [];
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { studentId: s._id.toString(), score: avg };
  });

  const ranked = computePositions(rankInput);
  return new Map(ranked.map((r) => [r.studentId, r.position]));
};
