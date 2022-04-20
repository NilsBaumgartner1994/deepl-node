// Copyright 2022 DeepL SE (https://www.deepl.com)
// Use of this source code is governed by an MIT
// license that can be found in the LICENSE file.

import * as deepl from 'deepl-node';

import fs from 'fs';

import { exampleText, tempFiles, withMockServer, makeTranslator } from './core';

const serverUrl = process.env.DEEPL_SERVER_URL;

describe('general', () => {
    it('rejects empty authKey', () => {
        expect(() => new deepl.Translator('', { serverUrl })).toThrow(/authKey.*empty/);
    });

    it('rejects invalid authKey', async () => {
        const translator = new deepl.Translator('invalid', { serverUrl });
        await expect(translator.getUsage()).rejects.toThrowError(deepl.AuthorizationError);
    });

    it('gives correct example translations across all languages', () => {
        const translator = makeTranslator();

        const promises = [];
        for (const langCode in exampleText) {
            const inputText = exampleText[langCode];
            const sourceLang = deepl.nonRegionalLanguageCode(langCode);
            const promise = translator
                .translateText(inputText, sourceLang, 'en-US')
                // eslint-disable-next-line @typescript-eslint/no-loop-func, promise/always-return
                .then((result: deepl.TextResult) => {
                    expect(result.text.toLowerCase()).toContain('proton');
                });
            promises.push(promise);
        }
        return Promise.all(promises);
    }, 15000);

    it('throws AuthorizationError with an invalid auth key', async () => {
        const translator = makeTranslator({ authKey: 'invalid' });
        await expect(translator.getUsage()).rejects.toThrowError(deepl.AuthorizationError);
    });

    it('outputs usage', async () => {
        const translator = makeTranslator();
        const usage = await translator.getUsage();
        expect(usage.toString()).toContain('Usage this billing period');
    });

    it('lists source and target languages', async () => {
        const translator = makeTranslator();
        const sourceLanguages = await translator.getSourceLanguages();
        const targetLanguages = await translator.getTargetLanguages();

        for (const languagesKey in sourceLanguages) {
            const language = sourceLanguages[languagesKey];
            if (language.code === 'en') {
                expect(language.name).toBe('English');
            }
            expect(language.supportsFormality).toBeUndefined();
        }

        for (const languagesKey in targetLanguages) {
            const language = targetLanguages[languagesKey];
            if (language.code === 'de') {
                expect(language.supportsFormality).toBe(true);
                expect(language.name).toBe('English');
            }
            expect(language.supportsFormality).toBeDefined();
        }
    });

    it('lists glossary language pairs', () => {
        const translator = makeTranslator();
        return translator
            .getGlossaryLanguagePairs()
            .then((languagePairs: readonly deepl.GlossaryLanguagePair[]) => {
                expect(languagePairs.length).toBeGreaterThan(0);
                // eslint-disable-next-line promise/always-return
                for (const languagePairsKey in languagePairs) {
                    const languagePair = languagePairs[languagePairsKey];
                    expect(languagePair.sourceLang.length).toBeGreaterThan(0);
                    expect(languagePair.targetLang.length).toBeGreaterThan(0);
                }
            });
    });

    it('should determine API free accounts using auth key', () => {
        expect(deepl.isFreeAccountAuthKey('0000:fx')).toBe(true);
        expect(deepl.isFreeAccountAuthKey('0000')).toBe(false);
    });

    withMockServer('should throw ConnectionError with timed-out responses', async () => {
        const translator = makeTranslator({
            mockServerNoResponseTimes: 2,
            maxRetries: 0,
            minTimeout: 1000,
        });
        await expect(translator.getUsage()).rejects.toThrowError(deepl.ConnectionError);
    });

    withMockServer('should throw TooManyRequestsError with 429 responses', async () => {
        const translator = makeTranslator({
            mockServer429ResponseTimes: 2,
            maxRetries: 0,
            minTimeout: 1000,
        });
        await expect(translator.translateText(exampleText.en, null, 'de')).rejects.toThrowError(
            deepl.TooManyRequestsError,
        );
    });

    withMockServer('should give QuotaExceededError when usage limits are reached', async () => {
        const characterLimit = 20;
        const documentLimit = 1;
        const [exampleDocument, , outputDocumentPath] = tempFiles();

        const translator = makeTranslator({
            randomAuthKey: true,
            mockServerInitCharacterLimit: characterLimit,
            mockServerInitDocumentLimit: documentLimit,
        });

        let usage = await translator.getUsage();
        expect(usage.character?.limit).toBe(characterLimit);
        expect(usage.document?.limit).toBe(documentLimit);
        expect(usage.character?.limitReached()).toBe(false);
        expect(usage.document?.limitReached()).toBe(false);
        expect(usage.teamDocument).toBeUndefined();

        // Translate a document with characterLimit characters
        fs.writeFileSync(exampleDocument, 'a'.repeat(characterLimit));
        await translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de');

        usage = await translator.getUsage();
        expect(usage.character?.limitReached()).toBe(true);
        expect(usage.document?.limitReached()).toBe(true);

        // Translate another document to get error
        fs.unlinkSync(outputDocumentPath);
        await expect(
            translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de'),
        ).rejects.toThrowError(
            'while translating document: Quota for this billing period has been exceeded',
        );

        // Translate text raises QuotaExceededError
        await expect(translator.translateText('Test', null, 'de')).rejects.toThrowError(
            deepl.QuotaExceededError,
        );
    });

    withMockServer(
        'should give QuotaExceededError when team document usage limits are reached',
        async () => {
            const characterLimit = 20;
            const documentLimit = 0;
            const teamDocumentLimit = 1;
            const [exampleDocument, , outputDocumentPath] = tempFiles();

            const translator = makeTranslator({
                randomAuthKey: true,
                mockServerInitCharacterLimit: characterLimit,
                mockServerInitDocumentLimit: documentLimit,
                mockServerInitTeamDocumentLimit: teamDocumentLimit,
            });

            let usage = await translator.getUsage();
            expect(usage.character?.limit).toBe(characterLimit);
            expect(usage.character?.limitReached()).toBe(false);
            expect(usage.document).toBeUndefined();
            expect(usage.teamDocument?.limit).toBe(teamDocumentLimit);
            expect(usage.teamDocument?.limitReached()).toBe(false);

            // Translate a document with characterLimit characters
            fs.writeFileSync(exampleDocument, 'a'.repeat(characterLimit));
            await translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de');

            usage = await translator.getUsage();
            expect(usage.character?.limitReached()).toBe(true);
            expect(usage.teamDocument?.limitReached()).toBe(true);

            // Translate another document to get error
            fs.unlinkSync(outputDocumentPath);
            await expect(
                translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de'),
            ).rejects.toThrowError(
                'while translating document: Quota for this billing period has been exceeded',
            );

            // Translate text raises QuotaExceededError
            await expect(translator.translateText('Test', null, 'de')).rejects.toThrowError(
                deepl.QuotaExceededError,
            );
        },
    );

    withMockServer('should give QuotaExceededError when usage limits are reached', async () => {
        const teamDocumentLimit = 1;
        const [exampleDocument, , outputDocumentPath] = tempFiles();

        const translator = makeTranslator({
            randomAuthKey: true,
            mockServerInitCharacterLimit: 0,
            mockServerInitDocumentLimit: 0,
            mockServerInitTeamDocumentLimit: teamDocumentLimit,
        });

        let usage = await translator.getUsage();
        expect(usage.character).toBeUndefined();
        expect(usage.document).toBeUndefined();
        expect(usage.teamDocument?.limit).toBe(teamDocumentLimit);
        expect(usage.teamDocument?.limitReached()).toBe(false);

        await translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de');

        usage = await translator.getUsage();
        expect(usage.anyLimitReached()).toBe(true);
        expect(usage.character).toBeUndefined();
        expect(usage.document).toBeUndefined();
        expect(usage.teamDocument?.limitReached()).toBe(true);

        // Translate another document to get error
        fs.unlinkSync(outputDocumentPath);
        await expect(
            translator.translateDocument(exampleDocument, outputDocumentPath, null, 'de'),
        ).rejects.toThrowError(
            'while translating document: Quota for this billing period has been exceeded',
        );
    });
});
