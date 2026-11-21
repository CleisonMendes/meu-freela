import { useEffect, useState } from "react";
import type { Cents } from "../financeTypes";
import { parseMoney } from "../lib/money";

const plain = (cents: Cents) => (cents / 100).toFixed(2).replace(".", ",");

interface Props {
  valueCents: Cents;
  onChange: (cents: Cents) => void;
  label: string;
  disabled?: boolean;
}

/** Campo de valor em R$: o usuário digita "2.229,00" e o app guarda centavos inteiros. */
export default function MoneyInput({ valueCents, onChange, label, disabled }: Props) {
  const [text, setText] = useState(valueCents ? plain(valueCents) : "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === "" ? 0 : parseMoney(current);
      return parsed === valueCents ? current : valueCents ? plain(valueCents) : "";
    });
  }, [valueCents]);

  function handleChange(next: string) {
    setText(next);
    const cents = next.trim() === "" ? 0 : parseMoney(next);
    setInvalid(cents === null);
    if (cents !== null) onChange(cents);
  }

  return (
    <input
      className={`money-input ${invalid ? "invalid" : ""}`}
      inputMode="decimal"
      placeholder="0,00"
      aria-label={label}
      aria-invalid={invalid}
      disabled={disabled}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
    />
  );
}