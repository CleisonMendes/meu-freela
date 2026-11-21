import { createContext, useContext } from "react";

export type AccessLevel = "owner" | "manager" | "member";

export interface Me {
  access: AccessLevel;
  /** Cadastro de equipe ligado ao login (só para integrantes com login). */
  memberId: string | null;
  email: string;
}

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  owner: "Dono",
  manager: "Gerente",
  member: "Integrante",
};

/** No modo local (sem nuvem) quem usa o app é o dono. */
export const AccessContext = createContext<Me>({ access: "owner", memberId: null, email: "" });

export const useMe = () => useContext(AccessContext);

/** Dono e gerentes: fecham o dia, confirmam pagamentos de qualquer um e editam a equipe. */
export const isStaff = (me: Me) => me.access !== "member";

/** Integrante só edita o que é dele; dono e gerentes editam tudo. */
export const canEditMember = (me: Me, memberId: string) => isStaff(me) || me.memberId === memberId;