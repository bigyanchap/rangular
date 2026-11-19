import { Component } from '@angular/core';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-team-form',
  templateUrl: './team-form.component.html',
})
export class TeamFormComponent {
  teamForm = new FormGroup({
    team: new FormControl('', Validators.required),
    members: new FormArray([
      new FormControl('', Validators.required),
      new FormControl('Ana'),
    ]),
  });
  summary = '';

  addMember() {
    (this.teamForm.get('members') as FormArray).push(new FormControl('', Validators.required));
  }

  removeMember(i: number) {
    (this.teamForm.get('members') as FormArray).removeAt(i);
  }

  save() {
    this.summary = JSON.stringify(this.teamForm.value);
  }
}
