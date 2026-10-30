"use client";
/**
 * Finanzas (Entrega 4): gastos fijos del mes (renta, luz, sueldos...) y
 * gastos sueltos con fecha, por sucursal. Con las ventas y el costo de lo
 * vendido (recetas) se saca la utilidad real y el punto de equilibrio.
 */

export type FixedExpense = { id: string; name: string; category: string; amount: number };
export type Expense = { id: string; date: string; concept: string; amount: number };

const FIXED_KEY = "bpos_fixed_expenses";
const EXPENSES_KEY = "bpos_expenses";
export const FINANCE_EVENT = "bpos:finance-updated";

export const EXPENSE_CATEGORIES = ["Renta", "Sueldos", "Luz", "Gas", "Agua", "Internet y teléfono", "Publicidad", "Sistemas", "Mantenimiento", "Otro"];

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, list: unknown[]) {
  localStorage.setItem(key, JSON.stringify(list));
  window.dispatchEvent(new Event(FINANCE_EVENT));
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const getFixedExpenses = () => read<FixedExpense>(FIXED_KEY);
export const getExpenses = () => read<Expense>(EXPENSES_KEY);

export function addFixedExpense(name: string, category: string, amount: number) {
  if (!name.trim() || !(amount > 0)) throw new Error("Escribe el gasto y cuánto pagas al mes.");
  write(FIXED_KEY, [...getFixedExpenses(), { id: newId("f"), name: name.trim().slice(0, 60), category, amount }]);
}

export function updateFixedExpense(id: string, amount: number) {
  write(FIXED_KEY, getFixedExpenses().map((e) => (e.id === id ? { ...e, amount: Math.max(0, amount) } : e)));
}

export function removeFixedExpense(id: string) {
  write(FIXED_KEY, getFixedExpenses().filter((e) => e.id !== id));
}

export function addExpense(date: string, concept: string, amount: number) {
  if (!concept.trim() || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Escribe fecha, concepto y monto.");
  write(EXPENSES_KEY, [...getExpenses(), { id: newId("g"), date, concept: concept.trim().slice(0, 80), amount }]);
}

export function removeExpense(id: string) {
  write(EXPENSES_KEY, getExpenses().filter((e) => e.id !== id));
}

/**
 * Punto de equilibrio: lo que hay que vender al mes para cubrir los gastos
 * fijos con lo que deja cada peso vendido (margen bruto). null si todavía
 * no hay margen para calcularlo.
 */
export function breakEven(fixed: number, grossMarginPct: number) {
  if (!(grossMarginPct > 0)) return null;
  return fixed / (grossMarginPct / 100);
}
