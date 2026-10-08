/**
 * Inscription et connexion.
 *
 * Un seul écran, deux modes. L'action principale est évidente, et le message
 * d'erreur vient de l'API sans être reformulé : elle ne renvoie jamais de
 * détail interne, donc ce qui arrive est affichable tel quel.
 */

import { useState, type FormEvent } from "react";
import { AuryaMark } from "../components/AppShell.js";
import { Button, Card, Field } from "../components/ui.js";
import { ApiError, signIn, signUp, type User } from "../lib/api.js";
import "./Auth.css";

export function Auth({ onAuthenticated }: { onAuthenticated: (u: User) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const inscription = mode === "signup";

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (enCours) return;

    setErreur(null);
    setEnCours(true);
    try {
      const user = inscription
        ? await signUp(email, password)
        : await signIn(email, password);
      onAuthenticated(user);
    } catch (err) {
      setErreur(
        err instanceof ApiError ? err.message : "Une erreur est survenue.",
      );
      setEnCours(false);
    }
  }

  return (
    <main className="auth">
      <Card large className="auth__card">
        <div className="auth__brand">
          <AuryaMark />
          <span className="auth__wordmark">Aurya</span>
        </div>

        <h1 className="auth__title">
          {inscription ? "Create your account." : "Welcome back."}
        </h1>
        <p className="auth__lead">
          {inscription
            ? "Turn product photos into ads that sell."
            : "Your next winning creative starts here."}
        </p>

        <form className="auth__form" onSubmit={soumettre} noValidate>
          <Field
            label="E-mail"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="vous@entreprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Mot de passe"
            type="password"
            name="password"
            autoComplete={inscription ? "new-password" : "current-password"}
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...(inscription ? { hint: "12 caractères minimum." } : {})}
            required
          />

          {/* L'erreur est annoncée aux lecteurs d'écran, pas seulement affichée. */}
          {erreur ? (
            <p className="auth__error" role="alert">
              {erreur}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" block disabled={enCours}>
            {enCours
              ? "Un instant…"
              : inscription
                ? "Create account"
                : "Sign in"}
          </Button>
        </form>

        <p className="auth__switch">
          {inscription ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"}{" "}
          <button
            type="button"
            className="auth__link"
            onClick={() => {
              setMode(inscription ? "signin" : "signup");
              setErreur(null);
            }}
          >
            {inscription ? "Se connecter" : "Créer un compte"}
          </button>
        </p>

        {!inscription ? null : (
          <p className="auth__note">
            50 crédits offerts à l'inscription, sans carte bancaire.
          </p>
        )}
      </Card>
    </main>
  );
}
