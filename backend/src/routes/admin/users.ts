import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../../models/User.js";

export const adminUsersRouter = Router();

adminUsersRouter.get("/", async (_req, res) => {
  const users = await User.find().select("email role createdAt").sort({ createdAt: 1 });
  res.json(users);
});

// The app is invite-only, so accounts are created here by an admin.
adminUsersRouter.post("/", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  const normalized = email.trim().toLowerCase();
  if (await User.findOne({ email: normalized })) {
    return res.status(409).json({ error: "User already exists" });
  }
  const user = await User.create({
    email: normalized,
    passwordHash: await bcrypt.hash(password, 10),
    role: "user",
  });
  res.status(201).json({ _id: user.id, email: user.email, role: user.role });
});

adminUsersRouter.delete("/:id", async (req, res) => {
  if (req.params.id === req.auth!.userId) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

// Promotion/demotion is admin-only; registration can never grant a role.
adminUsersRouter.patch("/:id/role", async (req, res) => {
  const { role } = req.body as { role?: "admin" | "user" };
  if (role !== "admin" && role !== "user") {
    return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  }

  if (role === "user" && req.params.id === req.auth!.userId) {
    return res.status(400).json({ error: "You cannot remove your own admin access" });
  }

  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select(
    "email role"
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});
