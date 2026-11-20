import { describe, expect, it } from "vitest";
import { mapColumns, parseCsv, parsePositionCell, parseRankCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted fields with delimiters, quotes and line breaks inside, and finds the delimiter", () => {
    const text = '﻿keyword;date\r\n"a; b";2026-11-01\n"say ""hi""\nthere";2026-11-02\n\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ["keyword", "date"] },
      { line: 2, cells: ["a; b", "2026-11-01"] },
      { line: 3, cells: ['say "hi"\nthere', "2026-11-02"] },
    ]);
    expect(parseCsv("a\tb\n1\t2")[1].cells).toEqual(["1", "2"]);
  });
});

describe("columns and cells", () => {
  it("maps English and Russian headers in any order", () => {
    expect(mapColumns(["Запрос", "Позиция", "Дата", "ПС", "Регион", "URL"])).toEqual({
      keyword: 0,
      position: 1,
      date: 2,
      engine: 3,
      region: 4,
      url: 5,
    });
  });

  it("reads ranks and the usual not-ranked markers", () => {
    expect(parsePositionCell("7")).toBe(7);
    for (const v of ["", "-", "0", ">100", "100+", "нет"]) expect(parsePositionCell(v), v).toBeNull();
    expect(parsePositionCell("abc")).toBeUndefined();
    expect(parsePositionCell("2.5")).toBeUndefined();
  });
});

describe("parseRankCsv", () => {
  it("turns good lines into rows and reports each bad line with its number", () => {
    const csv = [
      "keyword,date,position,url,engine,region,device",
      "quilltab app,2026-11-01,3,https://quilltab.app/,Яндекс,Москва,desktop",
      "notes app,01.11.2026,-,,Яндекс,Москва,",
      "bad date,2026-13-01,3,,Яндекс,Москва,",
      "bad pos,2026-11-01,x,,Яндекс,Москва,",
      "no engine,2026-11-01,3,,,Москва,",
      "bad url,2026-11-01,3,quilltab.app,Google,,mobile",
    ].join("\n");
    const r = parseRankCsv(csv);
    expect(r.total).toBe(6);
    expect(r.rows).toEqual([
      { keyword: "quilltab app", date: "2026-11-01", position: 3, url: "https://quilltab.app/", frequency: null, engine: "Яндекс", region: "Москва", device: "desktop" },
      { keyword: "notes app", date: "2026-11-01", position: null, url: null, frequency: null, engine: "Яндекс", region: "Москва", device: "" },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5, 6, 7]);
    expect(r.errors[0].message).toMatch(/YYYY-MM-DD/);
    expect(r.errors[1].message).toMatch(/whole number/);
    expect(r.errors[2].message).toMatch(/engine/);
    expect(r.errors[3].message).toMatch(/url/);
  });

  it("names the missing required columns", () => {
    const r = parseRankCsv("keyword,position\nk,1");
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 1, message: expect.stringMatching(/date, engine/) }]);
    expect(parseRankCsv("").errors[0].message).toMatch(/empty/);
  });
});
