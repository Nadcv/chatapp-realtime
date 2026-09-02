// Testa em isolamento a lógica pura de "esta despesa fixa vence hoje?" —
// mesma lógica usada no setInterval do server.js, extraída aqui para não
// depender de esperar por um tick real (o intervalo real corre de hora a
// hora, o que seria impraticável de testar diretamente).
function isRecurringExpenseDueToday(tpl, now) {
  const yearMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayDay = now.getDate();
  const effectiveDay = Math.min(tpl.dayOfMonth, daysInMonth);
  return todayDay === effectiveDay && tpl.lastPostedKey !== yearMonthKey;
}

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (cond) pass++; else fail++;
}

// Dia normal, ainda não lançada este mês.
check('Dispara no dia exato do mês (dia 15, tpl dia 15)', isRecurringExpenseDueToday({ dayOfMonth: 15, lastPostedKey: null }, new Date(2026, 7, 15)));
// Dia errado.
check('NÃO dispara em dia diferente (dia 14, tpl dia 15)', !isRecurringExpenseDueToday({ dayOfMonth: 15, lastPostedKey: null }, new Date(2026, 7, 14)));
// Já lançada este mês.
check('NÃO dispara de novo no mesmo mês (já lançada em 2026-08)', !isRecurringExpenseDueToday({ dayOfMonth: 15, lastPostedKey: '2026-08' }, new Date(2026, 7, 15)));
// Mês seguinte, mesma tpl já lançada no mês anterior -> deve disparar de novo.
check('Dispara de novo no mês seguinte (lastPostedKey de mês anterior)', isRecurringExpenseDueToday({ dayOfMonth: 15, lastPostedKey: '2026-08' }, new Date(2026, 8, 15)));
// Clamping: dia 31 num mês de 30 dias (setembro) cai no dia 30.
check('Dia 31 é ajustado (clamp) para o dia 30 em setembro (30 dias)', isRecurringExpenseDueToday({ dayOfMonth: 31, lastPostedKey: null }, new Date(2026, 8, 30)));
check('Dia 31 NÃO dispara no dia 29 de setembro (ainda não é o último dia)', !isRecurringExpenseDueToday({ dayOfMonth: 31, lastPostedKey: null }, new Date(2026, 8, 29)));
// Clamping: dia 31 em fevereiro (2026 não é bissexto, 28 dias).
check('Dia 31 é ajustado (clamp) para o dia 28 em fevereiro não-bissexto', isRecurringExpenseDueToday({ dayOfMonth: 31, lastPostedKey: null }, new Date(2026, 1, 28)));
// Fevereiro bissexto (2028, 29 dias).
check('Dia 31 é ajustado (clamp) para o dia 29 em fevereiro bissexto (2028)', isRecurringExpenseDueToday({ dayOfMonth: 31, lastPostedKey: null }, new Date(2028, 1, 29)));
// Dia 31 num mês de 31 dias (janeiro) não precisa de clamp.
check('Dia 31 dispara normalmente em janeiro (31 dias, sem clamp)', isRecurringExpenseDueToday({ dayOfMonth: 31, lastPostedKey: null }, new Date(2026, 0, 31)));

console.log(`\n${pass} passou, ${fail} falhou.`);
process.exit(fail ? 1 : 0);
