import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ControllerClient } from '../../client';
import { RpcAction, Workflow } from '@deepkit/framework-debug-shared';

@Component({
  template: `
    <div class="header">
      <h4>RPC Workflow</h4>
    </div>
    <div style="height: 250px; margin-bottom: 10px; overflow: auto" class="overlay-scrollbar-small">
      <app-workflow [workflow]="workflow"></app-workflow>
    </div>
    <div class="header">
      <h4>RPC Actions</h4>
      <dui-input placeholder="Filter" round semiTransparent lightFocus [(ngModel)]="filterQuery"></dui-input>
    </div>
    <dui-table
      style="flex: 1 1"
      [items]="filter(actions, filterQuery)" [(selected)]="selected" selectable defaultSort="path" noFocusOutline>
      <dui-table-column [width]="220" name="controller"></dui-table-column>
      <dui-table-column [width]="220" name="path"></dui-table-column>
      <dui-table-column [width]="220" name="methodName"></dui-table-column>
      <dui-table-column [width]="220" name="parameters">
        <ng-container *duiTableCell="let row">
          {{getParameters(row)}}
        </ng-container>
      </dui-table-column>
    </dui-table>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .header {
      display: flex;
      margin-bottom: 15px;
    }

    .header dui-input {
      margin-left: auto;
    }
  `]
})
export class RpcComponent implements OnInit {
  public actions: RpcAction[] = [];
  public selected: RpcAction[] = [];
  public workflow?: Workflow;

  public filterQuery: string = '';

  constructor(
    private controllerClient: ControllerClient,
    public cd: ChangeDetectorRef,
  ) {
  }

  get route() {
    return this.selected[0];
  }

  getParameters(action: RpcAction): string {
    return action.parameters.map(p => p.name + ':' + p.propertySchema.toString()).join(', ');
  }

  filter(items: RpcAction[], filter: string): any[] {
    if (!filter) return items;

    return items.filter(v => (v.path.includes(filter) || v.controller.includes(filter) || v.methodName.includes(filter)));
  }

  async ngOnInit(): Promise<void> {
    [this.actions, this.workflow] = await Promise.all([
      this.controllerClient.debug.actions(),
      this.controllerClient.debug.getWorkflow('rpc'),
    ]);
    this.cd.detectChanges();
  }

}
