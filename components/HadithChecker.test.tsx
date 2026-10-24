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

// Each result's grade, with how it reads.
const badges = () => screen.getAllByRole('listitem').map((item) => item.querySelector('[data-grade-tone]'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HadithChecker', () => {
  it('shows the whole grade, without Dorar\'s brackets wherever they fall in it', async () => {
    render(<HadithChecker />);
    search('اطلبوا العلم ولو بالصين');

    expect(await screen.findByText('فيه أبو العاتكة لا يعرف، وليس لهذا الحديث أصل')).toBeDefined();
    expect(screen.getByText('منكر', { selector: 'span' })).toBeDefined();
    expect(screen.queryByText(/[[\]]/)).toBeNull();
  });

  it('colours grades that criticise a narrator red, as well as unsound ones, and sound ones gold', async () => {
    render(<HadithChecker />);
    expect(badges().map((badge) => badge?.getAttribute('data-grade-tone'))).toEqual(['sound', 'sound']);

    search('اطلبوا العلم ولو بالصين');
    await screen.findByText('منكر', { selector: 'span' });
    expect(badges().map((badge) => badge?.getAttribute('data-grade-tone'))).toEqual(RESULTS.map(() => 'weak'));
    expect(badges()[0]?.className).toContain('text-danger');
  });

  it('keeps a grade that is neither plainly sound nor weak grey, never gold', async () => {
    render(<HadithChecker />);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { text: 'من حدث عني بحديث يرى أنه كذب فهو أحد الكاذبين', muhaddith: 'مسلم', source: 'صحيح مسلم', number: '1', grade: 'أورده مسلم في مقدمة صحيحه' },
              { text: 'نص', muhaddith: 'فلان', source: 'كتاب', grade: 'ليس بحديث' },
            ],
          })
        )
      )
    );
    fireEvent.change(screen.getByLabelText('جزء من نص الحديث'), { target: { value: 'من حدث عني بحديث' } });
    fireEvent.click(screen.getByRole('button', { name: 'تحقق' }));

    expect(await screen.findByText('أورده مسلم في مقدمة صحيحه')).toBeDefined();
    expect(badges().map((badge) => badge?.getAttribute('data-grade-tone'))).toEqual(['unclear', 'weak']);
    expect(badges()[0]?.className).not.toContain('gold');
  });
});
