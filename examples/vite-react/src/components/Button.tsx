// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

export interface ButtonProps {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export function Button({ variant = "primary", children }: ButtonProps) {
  return (
    <button className={`btn btn-${variant}`} type="button">
      {children}
    </button>
  );
}
