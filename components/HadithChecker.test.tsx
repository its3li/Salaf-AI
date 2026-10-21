import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HadithChecker } from './HadithChecker';

// Six of Dorar.net's results for «اطلبوا العلم ولو بالصين» (checked October 2026), all unsound. Its
// grades put brackets anywhere, and most criticise a narrator rather than name a grade.
const RESULTS = [
  {
    text: 'اطلُبوا العِلْمَ ولو بالصِّينِ.',
    muhaddith: 'البزار',
    source: 'البحر الزخار',
    number: '1/175',
    grade: '[فيه] أبو العاتكة لا يعرف، وليس لهذا الحديث أصل',
  },
  {
    text: 'اطلُبوا العِلمَ ولو بِالصِّينِ.',
    muhaddith: 'الذهبي',
    source: 'ميزان الاعتدال',
    number: '2/335',
    grade: '[فيه طريف بن سلمان أبو عاتكة ذكر من جرحه]',
  },
  {
    text: 'اطلُبوا العِلْمَ ولو بالصِّينِ.',
    muhaddith: 'الذهبي',
    source: 'ميزان الاعتدال',
    number: '1/107',
    grade: '[فيه] أحمد بن عبد الله الجويباري ممن يضرب المثل بكذبه',
  },
  {
    text: 'اطْلُبوا العِلمَ ولو بالصِّينِ ؛ فإنَّه فَريضةٌ على كلِّ مُسلمٍ.',
    muhaddith: 'يحيى بن معين',
    source: 'المنتخب من العلل للخلال',
    number: '108',
    grade: '[فيه] أبو عاتكة هذا، لم أعرفه',
  },
  {
    text: 'اطْلُبوا العِلمَ ولو بالصِّينِ ؛ فإنَّه فَريضةٌ على كلِّ مُسلمٍ.',
    muhaddith: 'الإمام أحمد',
    source: 'المنتخب من العلل للخلال',
    number: '109',
    grade: '[منكر]',
  },
  {
    text: 'اطلُبوا العِلمَ ولو بالصِّينِ فإنَّ طلبَ العِلمِ فريضةٌ على كلِّ مسلمٍ.',
    muhaddith: 'ابن عدي',
    source: 'الكامل في الضعفاء',
    number: '5/188',
    grade: '[فيه] أبو عاتكة عن أنس عامة ما يرويه عن أنس لا يتابعه عليه أحد من الثقات',
  },
];

const search = (query: string) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: RESULTS }))));
  fireEvent.change(screen.getByLabelText('جزء من نص الحديث'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'تحقق' }));
};

// Each result's grade badge: the only span in its row.
const badges = () => screen.getAllByRole('listitem').map((item) => item.querySelector('span'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HadithChecker', () => {
  it('drops Dorar\'s brackets wherever they fall in a grade and shortens long grades', async () => {
    render(<HadithChecker />);
    search('اطلبوا العلم ولو بالصين');

    expect(await screen.findByText('فيه أبو العاتكة لا…')).toBeDefined();
    expect(screen.getByText('منكر', { selector: 'span' })).toBeDefined();
    expect(screen.queryByText(/[[\]]/)).toBeNull();
  });

  it('colours grades that criticise a narrator red, as well as unsound ones, and the others gold', async () => {
    render(<HadithChecker />);
    expect(badges().map((badge) => badge?.className)).toEqual([
      expect.stringContaining('text-gold-text'),
      expect.stringContaining('text-gold-text'),
    ]);

    search('اطلبوا العلم ولو بالصين');
    await screen.findByText('منكر', { selector: 'span' });
    expect(badges().map((badge) => badge?.className)).toEqual(
      RESULTS.map(() => expect.stringContaining('text-danger'))
    );
  });
});
