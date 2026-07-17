"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const data = await api<{ token: string; user: unknown }>("/auth/register", { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("jikmis_token", data.token);
      localStorage.setItem("jikmis_user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Registration failed.");
    }
  }

  return (
    <main>
      <section className="auth-shell">
        <Link className="brand" href="/"><span className="brand-mark">JA</span><span>Jikmis Apartment</span></Link>
        <h1>Register</h1>
        <form className="form-grid" onSubmit={submit}>
          {(["name", "email", "phone", "password"] as const).map((key) => (
            <label key={key}>{key}<input type={key === "password" ? "password" : "text"} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required={key !== "phone"} /></label>
          ))}
          <button className="button primary">Create account</button>
          <Link className="text-link" href="/login">Login instead</Link>
        </form>
        {message && <p className="message error">{message}</p>}
      </section>
    </main>
  );
}
