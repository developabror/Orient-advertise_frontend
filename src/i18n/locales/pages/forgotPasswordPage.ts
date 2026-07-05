const en = {
  title: 'Forgot password',
  subtitle: "Enter your email and we'll send a reset link if an account exists.",
  labelEmail: 'Email address',
  submit: 'Send reset link',
  sent: "If an account exists for that email, we've sent a reset link. Check your inbox.",
  errEmailRequired: 'Enter your email address.',
  errEmailInvalid: 'Enter a valid email address.',
  errRateLimited: 'Too many attempts. Please wait a moment and try again.',
  backToLogin: 'Back to sign in',
};

export const dict = {
  en,
  ru: {
    title: 'Забыли пароль',
    subtitle: 'Введите эл. почту — если аккаунт существует, мы отправим ссылку для сброса.',
    labelEmail: 'Адрес эл. почты',
    submit: 'Отправить ссылку',
    sent: 'Если аккаунт с такой почтой существует, мы отправили ссылку для сброса. Проверьте почту.',
    errEmailRequired: 'Введите адрес эл. почты.',
    errEmailInvalid: 'Введите корректный адрес эл. почты.',
    errRateLimited: 'Слишком много попыток. Подождите немного и попробуйте снова.',
    backToLogin: 'Вернуться ко входу',
  } satisfies typeof en,
  uz: {
    title: 'Parolni unutdingizmi',
    subtitle: 'Emailingizni kiriting — hisob mavjud boʻlsa, tiklash havolasini yuboramiz.',
    labelEmail: 'Email manzil',
    submit: 'Tiklash havolasini yuborish',
    sent: 'Agar shu email bilan hisob mavjud boʻlsa, tiklash havolasini yubordik. Pochtangizni tekshiring.',
    errEmailRequired: 'Email manzilingizni kiriting.',
    errEmailInvalid: 'Toʻgʻri email manzilini kiriting.',
    errRateLimited: 'Urinishlar juda koʻp. Biroz kuting va qayta urinib koʻring.',
    backToLogin: 'Kirishga qaytish',
  } satisfies typeof en,
};
