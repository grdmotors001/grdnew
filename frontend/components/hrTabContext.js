'use client';
import { createContext } from 'react';

// HR > Attendance & Salary ke andar ke tabs ab upar header me dikhte hain. Shell tab ka state rakhta hai,
// HRAttendancePage usse padhta hai (context na mile to apna tab bar use karta hai).
export const HRTabContext = createContext(null);
export const HR_TABS = [
  ['dashboard', 'Dashboard'],
  ['employees', 'Employees'],
  ['attendance', 'Attendance'],
  ['punches', 'Outlet Punches'],
  ['outlets', 'Outlets'],
  ['timing', 'Dept Timing'],
  ['offs', 'Off / Holiday'],
  ['salary', 'Salary'],
];
