import { useId } from 'react';
import type { FieldDef, LabMeta } from '../content';
import { formatField, readSetting } from '../content';
import type { LabConfig } from '../model';
import { HelpTip } from './ui';

interface ConfigFormProps {
  lab: LabMeta;
  config: LabConfig;
  lockedKeys: string[];
  onChange: (key: string, value: string | number | boolean) => void;
  onShuffleSeed: () => void;
}

export function ConfigForm({ lab, config, lockedKeys, onChange, onShuffleSeed }: ConfigFormProps) {
  const seedId = useId();
  const seedLocked = lockedKeys.includes('seed');
  return (
    <form className="config" onSubmit={(event) => event.preventDefault()}>
      {lab.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={readSetting(config, field.key)}
          locked={lockedKeys.includes(field.key)}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
      <div className="field">
        <span className="field-label">
          <label htmlFor={seedId}>Seed</label>
          <HelpTip text={lab.seedHelp} />
        </span>
        <span className="seed-row">
          <input
            id={seedId}
            type="number"
            min={1}
            max={9999}
            step={1}
            value={config.seed}
            disabled={seedLocked}
            onChange={(event) => onChange('seed', clampSeed(event.target.value))}
          />
          <button type="button" className="button ghost" onClick={onShuffleSeed} disabled={seedLocked}>
            Shuffle
          </button>
        </span>
        {seedLocked && <span className="lock-note">Locked in this challenge</span>}
      </div>
    </form>
  );
}

function Field({
  field,
  value,
  locked,
  onChange,
}: {
  field: FieldDef;
  value: string | number | boolean;
  locked: boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  const id = useId();
  const display = formatField(field, value);
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{field.label}</label>
        <HelpTip text={field.help} />
      </span>
      {field.kind === 'range' && (
        <>
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number(value)}
            disabled={locked}
            aria-valuetext={display}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="field-value">{display}</span>
        </>
      )}
      {field.kind === 'select' && (
        <select
          id={id}
          value={String(value)}
          disabled={locked}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
      {field.kind === 'toggle' && (
        <button
          id={id}
          type="button"
          className={`switch${value ? ' on' : ''}`}
          aria-pressed={Boolean(value)}
          disabled={locked}
          onClick={() => onChange(!value)}
        >
          <span className="switch-knob" aria-hidden="true" />
          {value ? 'On' : 'Off'}
        </button>
      )}
      {locked && <span className="lock-note">Locked in this challenge</span>}
    </div>
  );
}

function clampSeed(raw: string): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(9999, value));
}
