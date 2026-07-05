import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  text: string;
  max?: number;
  className?: string;
}

export const ExpandableText = ({ text, max = 100, className }: Props) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const wrapperClass = `oa-expandable${className !== undefined ? ' ' + className : ''}`;

  if (text.length <= max) {
    return <span className={wrapperClass}>{text}</span>;
  }
  const display = expanded ? text : `${text.slice(0, max)}…`;
  return (
    <span className={wrapperClass}>
      {display}
      <button
        type="button"
        className="oa-expandable__toggle"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
      >
        {expanded ? t('expandableText.less') : t('expandableText.more')}
      </button>
    </span>
  );
};
