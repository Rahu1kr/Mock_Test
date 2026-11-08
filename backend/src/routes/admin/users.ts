import { Router } from "express";
import { User } from "../../models/User.js";

export const adminUsersRouter = Router();

adminUsersRouter.get("/", async (_req, res) => {
  const users = await User.find().select("email role createdAt").sort({ createdAt: 1 });
  res.json(users);
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
