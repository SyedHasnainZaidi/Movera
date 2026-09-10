import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';
import { inputClass } from './ui';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Password field with a consistent show/hide control.
 *
 * Two problems this solves.
 *
 * 1. **The toggle used to appear only sometimes.** There was no toggle in this
 *    application at all - what users saw was the BROWSER's own reveal button.
 *    Edge and IE render `::-ms-reveal` inside password inputs, Chrome and
 *    Firefox render nothing, and Edge hides it again as soon as the field is
 *    scripted or re-rendered. So the control appeared on some fields, in some
 *    browsers, some of the time. `index.css` now hides the native button
 *    outright and this component supplies one that behaves identically
 *    everywhere.
 *
 * 2. **Visibility state leaking between entries.** Clearing the field resets
 *    the toggle to masked, so a password typed after an unmasked one is not
 *    silently displayed in plain text.
 *
 * The icon is shown only while the field has content, per the specification:
 * an empty field has nothing to reveal, so the button would be decoration that
 * screen readers still have to announce.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput({ onChange, className = '', ...rest }, forwardedRef) {
    const [visible, setVisible] = useState(false);
    const [hasValue, setHasValue] = useState(false);
    const innerRef = useRef<HTMLInputElement | null>(null);

    /**
     * The element is needed locally AND by whoever passed a ref
     * (react-hook-form's `register` passes a callback ref), so both are
     * populated from one callback.
     */
    const setRefs = useCallback(
      (element: HTMLInputElement | null) => {
        innerRef.current = element;
        if (typeof forwardedRef === 'function') {
          forwardedRef(element);
        } else if (forwardedRef) {
          forwardedRef.current = element;
        }
      },
      [forwardedRef],
    );

    // A browser filling a saved password does not fire a change event, so
    // without this the toggle would stay hidden over a populated field.
    useEffect(() => {
      const element = innerRef.current;
      if (element && element.value.length > 0) setHasValue(true);
    }, []);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      const filled = event.target.value.length > 0;
      setHasValue(filled);
      // Emptying the field re-masks it: the next password typed in starts hidden.
      if (!filled) setVisible(false);
      onChange?.(event);
    };

    return (
      <div className="relative">
        <input
          {...rest}
          ref={setRefs}
          type={visible ? 'text' : 'password'}
          onChange={handleChange}
          className={`${inputClass} ${hasValue ? 'pr-11' : ''} ${className}`}
        />

        {hasValue && (
          <button
            type="button"
            // Never a submit button: this sits inside a form and the default
            // button type would submit it.
            onClick={() => setVisible((current) => !current)}
            // The label states the ACTION, not the state, which is what a
            // screen reader user needs in order to decide whether to press it.
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-ink-400 transition-colors hover:text-ink-700 focus:outline-none focus-visible:text-brand-700"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    );
  },
);

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.7 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-2.7 3.7M6.6 6.6A18.3 18.3 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.4-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
