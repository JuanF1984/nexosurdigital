import { signOutAction } from "@/app/turnos/login/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
