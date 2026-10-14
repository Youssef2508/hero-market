@echo off
title تشغيل برنامج كاشير هيرو ماركت - HeroMarket POS
echo [1/2] تهيئة بيئة العمل المحمولة...
set Path=%~dp0node-portable;%Path%
cd /d "%~dp0"
echo [2/2] تشغيل واجهات الكاشير والربط مع قاعدة البيانات...
npm run dev
pause
