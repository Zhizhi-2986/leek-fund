/**
 * In-app prompt dialog: replaces the browser prompt API, which browsers
 * support but the DSH Desktop (Electron shell) does not — it silently returns
 * without showing a dialog, so prompt-driven flows (create / rename group) die
 * on desktop while working in a browser. Same look and interaction as the
 * other tree dialogs (SearchDialog / MoveDialog).
 */
import { useEffect, useRef, useState } from 'react'
import s from './styles.module.css'

export function PromptDialog({
  title,
  initialValue = '',
  placeholder,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: {
  title: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Called with the trimmed value; empty / whitespace-only names are rejected. */
  onConfirm: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function submit(): void {
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <div className={s.overlay} onClick={onCancel}>
      <div className={s.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={s.dialogTitle}>{title}</div>
        <div className={s.dialogBody}>
          <input
            ref={inputRef}
            className={s.input}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className={s.dialogFooter}>
          <button className={s.button} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`${s.button} ${s.buttonPrimary}`} onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
