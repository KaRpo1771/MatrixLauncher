'use strict';
/* ID приложения Microsoft Entra (Azure) для входа через Microsoft, встроен в лаунчер, пользователю вводить ничего не нужно.
   Один раз зарегистрируйте приложение: portal.azure.com → Microsoft Entra ID → Регистрации приложений → Создать,
   «Личные учётные записи Microsoft», платформа «Мобильные и классические приложения», redirect URI: http://localhost,
   включить «Разрешить потоки открытых клиентов». Доступ к Minecraft одобряет Mojang (aka.ms/AppRegInfo).
   Скопируйте «Application (client) ID» сюда. Если строку очистить, лаунчер покажет поле для ручного ввода. */
module.exports = 'c74a446c-56a5-4457-b2a2-05c5120cd8e3';
