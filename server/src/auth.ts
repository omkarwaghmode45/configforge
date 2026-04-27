import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { RequestUser } from "./types";

const secret = process.env.JWT_SECRET || "dev-secret-change-me";

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

function base64url(input: object) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

export function signToken(user: RequestUser) {
  const payload = base64url({ ...user, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): RequestUser | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RequestUser & { exp: number };
  if (parsed.exp < Date.now()) return null;
  return { id: parsed.id, email: parsed.email };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}
