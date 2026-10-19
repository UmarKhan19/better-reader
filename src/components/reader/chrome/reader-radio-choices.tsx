"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import styles from "./reader-chrome.module.css";

export function RadioChoices<T extends string>({ legend, value, options, onChange, presentation = "segmented" }: {
  legend: string; value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (value: T) => void;
  presentation?: "segmented" | "paper";
}) {
  const name = useId();
  return (
    <fieldset className={styles.settingGroup}>
      <legend>{legend}</legend>
      <div className={styles.radioChoices} data-presentation={presentation}>
        {options.map((option) => <label key={option.value} className={styles.radioChoice}
          data-paper-option={presentation === "paper" ? option.value : undefined}>
          <input type="radio" name={name} value={option.value} checked={value === option.value}
            onChange={() => onChange(option.value)} />
          {presentation === "paper" && <>
            <span className={styles.paperSample} aria-hidden="true">Aa</span>
            <Check className={styles.paperCheck} aria-hidden="true" />
          </>}
          {option.icon && <span className={styles.choiceIcon} aria-hidden="true">{option.icon}</span>}
          <span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>
  );
}
