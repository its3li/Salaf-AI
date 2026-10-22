import { useState, useCallback } from 'react';

/** `proceed` asks before something that costs credits; unlike `confirm` it is not destructive. */
export type DialogType = 'rename' | 'feedback' | 'alert' | 'confirm' | 'clearAll' | 'proceed';

export interface DialogPreview {
  title: string;
  detail?: string;
  imageUrl?: string;
}

/** A small gauge, e.g. today's credits: what this uses and what stays left of the total. */
export interface DialogMeter {
  label: string;
  /** What this uses, shown big, e.g. "two minutes". */
  uses: string;
  /** e.g. "46 of 50 left". */
  detail: string;
  total: number;
  /** Left before this, and after it. */
  before: number;
  after: number;
}

export interface DialogOptions {
  type: DialogType;
  title: string;
  message?: string;
  /** Shown in a highlighted box above the message. */
  warning?: string;
  /** A small card for what the dialog is about, e.g. a video's thumbnail and title. */
  preview?: DialogPreview;
  meters?: DialogMeter[];
  /** A short line under the meters, e.g. how the limits work. */
  footnote?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

export const useAppDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<DialogOptions | null>(null);
  const [inputValue, setInputValue] = useState('');
  
  // Notice: The resolver cannot be put in state directly because React evaluates functions passed to set state.
  // We wrap it in an object to avoid this.
  const [resolver, setResolver] = useState<{ resolve: (value: boolean | string | null) => void } | null>(null);

  const showDialog = useCallback((opts: DialogOptions): Promise<boolean | string | null> => {
    setOptions(opts);
    setInputValue(opts.defaultValue || '');
    setIsOpen(true);
    
    return new Promise((resolve) => {
      setResolver({ resolve });
    });
  }, []);

  const handleConfirm = useCallback((value?: string) => {
    setIsOpen(false);
    if (resolver) {
      if (options?.type === 'rename' || options?.type === 'feedback') {
        resolver.resolve(value || inputValue);
      } else {
        resolver.resolve(true);
      }
      setResolver(null);
    }
  }, [resolver, options, inputValue]);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    if (resolver) {
      resolver.resolve(null);
      setResolver(null);
    }
  }, [resolver]);

  return {
    dialogState: {
      isOpen,
      options,
      inputValue,
    },
    setInputValue,
    showDialog,
    handleConfirm,
    handleCancel,
  };
};
