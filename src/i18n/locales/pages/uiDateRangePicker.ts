const en = {
  startDate: 'Start date',
  endDate: 'End date',
};

export const dict = {
  en,
  ru: {
    startDate: 'Дата начала',
    endDate: 'Дата окончания',
  } satisfies typeof en,
  uz: {
    startDate: 'Boshlanish sanasi',
    endDate: 'Tugash sanasi',
  } satisfies typeof en,
};
