import type { InputHTMLAttributes } from "react";

import styles from "./Input.module.css";

export default function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={styles.input} {...props} />;
}
