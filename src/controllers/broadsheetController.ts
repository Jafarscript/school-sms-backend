import { Response } from "express";
import Student from "../models/Student";
import Subject from "../models/Subject";
import Score from "../models/Score";
import Term from "../models/Term";
import { AuthRequest } from "../middleware/auth";
import { computePositions } from "../utils/ranking";
import { foldCascade } from "../utils/cascadeAverage";

export const getBroadsheet = async (req: AuthRequest, res: Response) => {
  try {
    const { class: classId, term } = req.query;

    if (!classId || !term) {
      return res.status(400).json({ message: "class and term are required" });
    }

    const students = await Student.find({ class: classId }).sort({ name: 1 });
    const subjects = await Subject.find({ class: classId }).sort({ nameEnglish: 1 });

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

    const scoreMap = new Map<string, number>();
    scores.forEach((sc) => {
      scoreMap.set(`${sc.student.toString()}-${sc.subject.toString()}`, sc.total);
    });

    const rows = students.map((student) => {
      const subjectScores = subjects.map((subject) => {
        const key = `${student._id.toString()}-${subject._id.toString()}`;
        return {
          subject: subject._id,
          nameEnglish: subject.nameEnglish,
          nameArabic: subject.nameArabic,
          score: scoreMap.get(key) ?? null,
        };
      });

      const enteredScores = subjectScores.filter((s) => s.score !== null) as { score: number }[];
      const total = enteredScores.reduce((sum, s) => sum + s.score, 0);
      const average = enteredScores.length > 0 ? total / enteredScores.length : 0;

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

    const ranked = computePositions(
      rows.map((r) => ({ studentId: r.student.toString(), score: r.total }))
    );
    const positionMap = new Map(ranked.map((r) => [r.studentId, r.position]));

    const positioned = rows.map((row) => ({
      ...row,
      position: positionMap.get(row.student.toString())!,
    }));

    res.status(200).json({ subjects, rows: positioned });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

// Computes each student's overall cascading average (same formula as
// buildReportCardData: per-subject cascade through terms up to the given
// term, then averaged across subjects) and ranks the whole class by it.
// This MUST match buildReportCardData's math exactly, since a student's
// report card position comes directly from this function's output.
export const getClassCumulativePositions = async (
  classId: string,
  termId: string
): Promise<Map<string, number>> => {
  const currentTerm = await Term.findById(termId);
  if (!currentTerm) return new Map();

  const priorTerms = await Term.find({
    session: currentTerm.session,
    termNumber: { $lte: currentTerm.termNumber },
  }).sort({ termNumber: 1 });
  const priorTermIds = priorTerms.map((t) => t._id);

  const students = await Student.find({ class: classId });
  const subjects = await Subject.find({ class: classId });

  const scores = await Score.find({
    student: { $in: students.map((s) => s._id) },
    subject: { $in: subjects.map((s) => s._id) },
    term: { $in: priorTermIds },
  });

  // index: studentId -> subjectId -> termId -> total
  const scoreIndex = new Map<string, Map<string, Map<string, number>>>();
  scores.forEach((sc) => {
    const studentKey = sc.student.toString();
    const subjectKey = sc.subject.toString();
    if (!scoreIndex.has(studentKey)) scoreIndex.set(studentKey, new Map());
    const subjectMap = scoreIndex.get(studentKey)!;
    if (!subjectMap.has(subjectKey)) subjectMap.set(subjectKey, new Map());
    subjectMap.get(subjectKey)!.set(sc.term.toString(), sc.total);
  });

  const rankInput = students.map((student) => {
    const studentSubjectMap = scoreIndex.get(student._id.toString()) || new Map();

    // for each subject, fold the cascade in chronological term order,
    // exactly like buildReportCardData does — then average the per-subject
    // cascade results to get this student's overall cumulative score
    const perSubjectCascades = subjects
      .map((subject) => {
        const termMap = studentSubjectMap.get(subject._id.toString()) || new Map();
        const rawScoresAscending = priorTerms
          .map((t) => termMap.get(t._id.toString()))
          .filter((v): v is number => v !== undefined);
        return foldCascade(rawScoresAscending).finalValue;
      })
      .filter((v): v is number => v !== null);

    const overall =
      perSubjectCascades.length > 0
        ? perSubjectCascades.reduce((a, b) => a + b, 0) / perSubjectCascades.length
        : 0;

    return { studentId: student._id.toString(), score: overall };
  });

  const ranked = computePositions(rankInput);
  return new Map(ranked.map((r) => [r.studentId, r.position]));
};