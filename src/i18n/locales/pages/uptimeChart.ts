const en = {
  onlinePercent: 'Online %',
  ariaLabel: 'Daily online device percentage',
  tooltipLabel: '{{pct}} online · {{counts}}',
  deviceCount_one: '{{online}} of {{total}} device',
  deviceCount_other: '{{online}} of {{total}} devices',
};

export const dict = {
  en,
  ru: {
    onlinePercent: 'Онлайн %',
    ariaLabel: 'Ежедневный процент устройств онлайн',
    tooltipLabel: '{{pct}} онлайн · {{counts}}',
    deviceCount_one: '{{online}} из {{total}} устройства',
    deviceCount_other: '{{online}} из {{total}} устройств',
  } satisfies typeof en,
  uz: {
    onlinePercent: 'Onlayn %',
    ariaLabel: 'Kunlik onlayn qurilmalar foizi',
    tooltipLabel: '{{pct}} onlayn · {{counts}}',
    deviceCount_one: '{{total}} tadan {{online}} ta qurilma',
    deviceCount_other: '{{total}} tadan {{online}} ta qurilma',
  } satisfies typeof en,
};
