import { Response } from "express";
import Student from "../models/Student";
import { AuthRequest } from "../middleware/auth";

export const createStudent = async (req: AuthRequest, res: Response) => {
  try {
    const { name, gender, class: classId, branch, numberInClass } = req.body;
    const student = await Student.create({ name, gender, class: classId, branch, numberInClass });
    res.status(201).json(student);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

// GET /api/students?class=<classId>  — usually filtered by class/arm
export const getStudents = async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, string> = {};
    if (req.query.class) filter.class = req.query.class as string;
    if (req.query.branch) filter.branch = req.query.branch as string;

    const students = await Student.find(filter)
      .populate("class", "name arm")
      .sort({ numberInClass: 1, name: 1 });
    res.status(200).json(students);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

export const updateStudent = async (req: AuthRequest, res: Response) => {
  try {
    const updated = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: "Student not found" });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};

export const deleteStudent = async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await Student.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Student not found" });
    res.status(200).json({ message: "Student deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: (err as Error).message });
  }
};