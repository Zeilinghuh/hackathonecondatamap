import test from "node:test";
import assert from "node:assert/strict";
import {wakeQuestion} from "../../src/frontend/GUI/voiceinput.js";

test("wake phrase tolerates punctuation and common transcriptions of Capri",()=>{
  for(const wake of ["Hey Capri", "hey, capri", "Hey Capree", "Hey Cap Ree", "hey cap-ri", "Hay Capri", "heycapri", "hey coppery"]) {
    assert.equal(wakeQuestion(`${wake}! What year is this?`),"What year is this?",wake);
  }
  assert.equal(wakeQuestion("I said hey Capri, compare Leeds with London"),"compare Leeds with London");
});

test("unrelated speech does not wake Capri and a bare wake phrase has no question",()=>{
  for(const text of ["How is London?", "Capri is useful", "hey captain", "hey capricorn", "hey caprice", ""])assert.equal(wakeQuestion(text),null);
  assert.equal(wakeQuestion("Hey Capri."),"");
});
